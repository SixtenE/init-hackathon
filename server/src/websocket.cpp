#include "websocket.hpp"

#include "base64.hpp"
#include "sha1.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace {
constexpr std::string_view kWsMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
constexpr size_t kMaxIncoming = 64 * 1024;

void set_nonblock(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) {
    throw std::runtime_error("fcntl(O_NONBLOCK) failed");
  }
}

std::string header_value(const std::string& request, const std::string& name) {
  std::string lower = request;
  std::string key = name;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  const std::string needle = "\n" + key + ":";
  const auto pos = lower.find(needle);
  if (pos == std::string::npos) return {};
  size_t start = pos + needle.size();
  while (start < request.size() && (request[start] == ' ' || request[start] == '\t')) {
    ++start;
  }
  size_t end = start;
  while (end < request.size() && request[end] != '\r' && request[end] != '\n') {
    ++end;
  }
  return request.substr(start, end - start);
}

void append_u16(std::string& out, uint16_t value) {
  out.push_back(static_cast<char>(value >> 8));
  out.push_back(static_cast<char>(value & 0xff));
}

void append_u64(std::string& out, uint64_t value) {
  for (int i = 7; i >= 0; --i) {
    out.push_back(static_cast<char>((value >> (8 * i)) & 0xff));
  }
}
}  // namespace

WebSocketServer::WebSocketServer(int port) : port_(port) {}

WebSocketServer::~WebSocketServer() {
  for (auto& [id, client] : clients_) {
    if (client.fd >= 0) ::close(client.fd);
  }
  if (listen_fd_ >= 0) ::close(listen_fd_);
}

void WebSocketServer::bind_and_listen() {
  listen_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
  if (listen_fd_ < 0) throw std::runtime_error("socket() failed");

  int yes = 1;
  setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  set_nonblock(listen_fd_);

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  addr.sin_port = htons(static_cast<uint16_t>(port_));
  if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
    throw std::runtime_error("bind() failed — is the port already in use?");
  }
  if (listen(listen_fd_, 32) < 0) throw std::runtime_error("listen() failed");
  rebuild_pollfds();
  std::cout << "[server] listening on 0.0.0.0:" << port_ << std::endl;
}

void WebSocketServer::poll_once(int timeout_ms) {
  if (pollfds_.empty()) rebuild_pollfds();
  const int ready = ::poll(pollfds_.data(), pollfds_.size(), timeout_ms);
  if (ready < 0) {
    if (errno == EINTR) return;
    throw std::runtime_error("poll() failed");
  }
  if (ready == 0) return;

  if (pollfds_[0].revents & POLLIN) accept_new();

  std::vector<Id> readable;
  std::vector<Id> writable;
  std::vector<Id> dead;
  for (size_t i = 1; i < pollfds_.size(); ++i) {
    const int fd = pollfds_[i].fd;
    auto it = std::find_if(clients_.begin(), clients_.end(),
                           [fd](const auto& entry) { return entry.second.fd == fd; });
    if (it == clients_.end()) continue;
    const short events = pollfds_[i].revents;
    if (events & (POLLERR | POLLHUP | POLLNVAL)) {
      dead.push_back(it->first);
      continue;
    }
    if (events & POLLIN) readable.push_back(it->first);
    if (events & POLLOUT) writable.push_back(it->first);
  }

  for (Id id : readable) {
    auto it = clients_.find(id);
    if (it != clients_.end()) read_client(it->second);
  }
  for (Id id : writable) {
    auto it = clients_.find(id);
    if (it != clients_.end()) write_client(it->second);
  }
  for (Id id : dead) {
    auto it = clients_.find(id);
    if (it != clients_.end()) drop(it->second, true);
  }
}

void WebSocketServer::send_text(Id id, std::string_view message) {
  auto it = clients_.find(id);
  if (it == clients_.end() || !it->second.handshake) return;
  queue_frame(it->second, 0x1, message);
  write_client(it->second);
}

void WebSocketServer::close_client(Id id) {
  auto it = clients_.find(id);
  if (it == clients_.end()) return;
  queue_frame(it->second, 0x8, {});
  it->second.closing = true;
  write_client(it->second);
  drop(it->second, true);
}

void WebSocketServer::accept_new() {
  while (true) {
    sockaddr_in addr{};
    socklen_t len = sizeof(addr);
    const int fd = ::accept(listen_fd_, reinterpret_cast<sockaddr*>(&addr), &len);
    if (fd < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) break;
      std::cerr << "[server] accept failed: " << std::strerror(errno) << std::endl;
      break;
    }
    set_nonblock(fd);
    int yes = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));

    Client client;
    client.id = next_id_++;
    client.fd = fd;
    clients_.emplace(client.id, std::move(client));
    rebuild_pollfds();
  }
}

void WebSocketServer::read_client(Client& client) {
  char buffer[4096];
  while (true) {
    const ssize_t n = ::recv(client.fd, buffer, sizeof(buffer), 0);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) break;
      drop(client, true);
      return;
    }
    if (n == 0) {
      drop(client, true);
      return;
    }
    client.incoming.append(buffer, static_cast<size_t>(n));
    if (client.incoming.size() > kMaxIncoming) {
      drop(client, true);
      return;
    }
  }

  if (!client.handshake) {
    complete_handshake(client);
    if (!client.handshake) return;
  }

  while (true) {
    std::string message;
    bool is_close = false;
    bool is_ping = false;
    if (!extract_frame(client, message, is_close, is_ping)) break;
    if (is_close) {
      drop(client, true);
      return;
    }
    if (is_ping) {
      queue_frame(client, 0xA, message);
      write_client(client);
      continue;
    }
    if (on_message) on_message(client.id, message);
    if (clients_.find(client.id) == clients_.end()) return;
  }
}

void WebSocketServer::write_client(Client& client) {
  while (!client.outgoing.empty()) {
    const ssize_t n = ::send(client.fd, client.outgoing.data(), client.outgoing.size(), MSG_NOSIGNAL);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        rebuild_pollfds();
        return;
      }
      drop(client, true);
      return;
    }
    client.outgoing.erase(0, static_cast<size_t>(n));
  }
  rebuild_pollfds();
}

void WebSocketServer::complete_handshake(Client& client) {
  const auto end = client.incoming.find("\r\n\r\n");
  if (end == std::string::npos) return;
  const std::string request = client.incoming.substr(0, end + 4);
  client.incoming.erase(0, end + 4);

  if (request.find("GET ") != 0) {
    const char* response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
    client.outgoing.assign(response);
    write_client(client);
    drop(client, false);
    return;
  }

  if (request.find("GET /health") == 0 &&
      header_value(request, "Upgrade").empty()) {
    const char* response =
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK";
    client.outgoing.assign(response);
    write_client(client);
    drop(client, false);
    return;
  }

  const std::string key = header_value(request, "Sec-WebSocket-Key");
  if (key.empty()) {
    drop(client, false);
    return;
  }

  const std::string accept = base64_encode(sha1::hash_bytes(key + std::string(kWsMagic)));
  client.outgoing =
      "HTTP/1.1 101 Switching Protocols\r\n"
      "Upgrade: websocket\r\n"
      "Connection: Upgrade\r\n"
      "Sec-WebSocket-Accept: " +
      accept + "\r\n\r\n";
  write_client(client);
  client.handshake = true;
  std::cout << "[server] client " << client.id << " connected" << std::endl;
  if (on_open) on_open(client.id);
}

bool WebSocketServer::extract_frame(Client& client, std::string& message, bool& is_close,
                                   bool& is_ping) {
  is_close = false;
  is_ping = false;
  const auto& data = client.incoming;
  if (data.size() < 2) return false;

  const uint8_t b0 = static_cast<uint8_t>(data[0]);
  const uint8_t b1 = static_cast<uint8_t>(data[1]);
  const uint8_t opcode = b0 & 0x0f;
  const bool masked = (b1 & 0x80) != 0;
  uint64_t payload_len = b1 & 0x7f;
  size_t header = 2;

  if (payload_len == 126) {
    if (data.size() < 4) return false;
    payload_len = (uint8_t(data[2]) << 8) | uint8_t(data[3]);
    header = 4;
  } else if (payload_len == 127) {
    if (data.size() < 10) return false;
    payload_len = 0;
    for (int i = 0; i < 8; ++i) payload_len = (payload_len << 8) | uint8_t(data[2 + i]);
    header = 10;
  }

  if (!masked) {
    drop(client, true);
    return false;
  }
  if (data.size() < header + 4) return false;
  const size_t mask_offset = header;
  header += 4;
  if (payload_len > kMaxIncoming || data.size() < header + payload_len) {
    if (payload_len > kMaxIncoming) {
      drop(client, true);
    }
    return false;
  }

  message.resize(static_cast<size_t>(payload_len));
  for (uint64_t i = 0; i < payload_len; ++i) {
    message[i] = static_cast<char>(uint8_t(data[header + i]) ^ uint8_t(data[mask_offset + (i % 4)]));
  }
  client.incoming.erase(0, header + static_cast<size_t>(payload_len));

  if (opcode == 0x8) {
    is_close = true;
    return true;
  }
  if (opcode == 0x9) {
    is_ping = true;
    return true;
  }
  if (opcode == 0xA) return extract_frame(client, message, is_close, is_ping);
  if (opcode != 0x1 && opcode != 0x2) return extract_frame(client, message, is_close, is_ping);
  return true;
}

void WebSocketServer::queue_frame(Client& client, uint8_t opcode, std::string_view payload) {
  std::string frame;
  frame.push_back(static_cast<char>(0x80 | opcode));
  const uint64_t len = payload.size();
  if (len < 126) {
    frame.push_back(static_cast<char>(len));
  } else if (len <= 0xffff) {
    frame.push_back(126);
    append_u16(frame, static_cast<uint16_t>(len));
  } else {
    frame.push_back(127);
    append_u64(frame, len);
  }
  frame.append(payload.data(), payload.size());
  client.outgoing.append(frame);
}

void WebSocketServer::drop(Client& client, bool notify) {
  const Id id = client.id;
  if (client.fd >= 0) {
    ::close(client.fd);
    client.fd = -1;
  }
  clients_.erase(id);
  rebuild_pollfds();
  if (notify) {
    std::cout << "[server] client " << id << " disconnected" << std::endl;
    if (on_close) on_close(id);
  }
}

void WebSocketServer::rebuild_pollfds() {
  pollfds_.clear();
  pollfds_.push_back(pollfd{listen_fd_, POLLIN, 0});
  for (auto& [id, client] : clients_) {
    short events = POLLIN;
    if (!client.outgoing.empty()) events |= POLLOUT;
    pollfds_.push_back(pollfd{client.fd, events, 0});
  }
}
