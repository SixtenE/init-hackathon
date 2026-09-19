#include "websocket.hpp"

#include "base64.hpp"
#include "sha1.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <climits>
#include <cstring>
#include <iostream>
#include <limits.h>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

namespace {
constexpr std::string_view kWsMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
constexpr size_t kMaxIncoming = 64 * 1024;
constexpr uint64_t kMaxFileSize = 512ull * 1024ull * 1024ull;
constexpr size_t kFileChunk = 64 * 1024;
constexpr auto kPingInterval = std::chrono::seconds(2);
constexpr auto kIdleTimeout = std::chrono::seconds(8);
constexpr auto kHelloTimeout = std::chrono::seconds(5);

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

int hex_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

std::string url_decode(std::string_view in) {
  std::string out;
  out.reserve(in.size());
  for (size_t i = 0; i < in.size(); ++i) {
    if (in[i] == '%' && i + 2 < in.size()) {
      const int hi = hex_value(in[i + 1]);
      const int lo = hex_value(in[i + 2]);
      if (hi < 0 || lo < 0) return {};
      out.push_back(static_cast<char>((hi << 4) | lo));
      i += 2;
    } else if (in[i] == '+') {
      out.push_back(' ');
    } else {
      out.push_back(in[i]);
    }
  }
  return out;
}

bool parse_request_line(const std::string& request, std::string& method, std::string& path) {
  const auto line_end = request.find("\r\n");
  if (line_end == std::string::npos) return false;
  const std::string line = request.substr(0, line_end);
  const auto sp1 = line.find(' ');
  if (sp1 == std::string::npos) return false;
  const auto sp2 = line.find(' ', sp1 + 1);
  if (sp2 == std::string::npos) return false;
  method = line.substr(0, sp1);
  std::string target = line.substr(sp1 + 1, sp2 - sp1 - 1);
  const auto query = target.find('?');
  if (query != std::string::npos) target.resize(query);
  path = url_decode(target);
  return !method.empty() && !path.empty();
}

bool last_segment_has_extension(std::string_view path) {
  const auto slash = path.rfind('/');
  const std::string_view seg = slash == std::string_view::npos ? path : path.substr(slash + 1);
  const auto dot = seg.rfind('.');
  return dot != std::string_view::npos && dot != 0 && dot + 1 < seg.size();
}

bool resolve_under_root(const std::string& root, const std::string& url_path, std::string& out) {
  if (root.empty() || url_path.empty() || url_path.front() != '/') return false;
  if (url_path.find('\0') != std::string::npos) return false;
  if (url_path.size() > 2048) return false;

  std::vector<std::string> parts;
  size_t i = 0;
  while (i < url_path.size()) {
    if (url_path[i] == '/') {
      ++i;
      continue;
    }
    const size_t start = i;
    while (i < url_path.size() && url_path[i] != '/') ++i;
    const std::string seg = url_path.substr(start, i - start);
    if (seg == ".") continue;
    if (seg == "..") {
      if (parts.empty()) return false;
      parts.pop_back();
      continue;
    }
    if (seg.find('\\') != std::string::npos) return false;
    parts.push_back(seg);
  }

  out = root;
  for (const auto& part : parts) {
    out.push_back('/');
    out += part;
  }
  return true;
}

bool is_dir(const std::string& path) {
  struct stat st {};
  return ::stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

bool is_reg(const std::string& path, uint64_t& size) {
  struct stat st {};
  if (::stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) return false;
  if (st.st_size < 0) return false;
  size = static_cast<uint64_t>(st.st_size);
  return true;
}

bool path_stays_in_root(const std::string& root, const std::string& path) {
  char real_root[PATH_MAX];
  char real_path[PATH_MAX];
  if (!::realpath(root.c_str(), real_root)) return false;
  if (!::realpath(path.c_str(), real_path)) return false;
  const size_t n = std::strlen(real_root);
  if (std::strncmp(real_path, real_root, n) != 0) return false;
  return real_path[n] == '\0' || real_path[n] == '/';
}

std::string mime_for(std::string_view path) {
  auto dot = path.rfind('.');
  if (dot == std::string_view::npos) return "application/octet-stream";
  std::string ext(path.substr(dot + 1));
  for (char& c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

  if (ext == "html" || ext == "htm") return "text/html; charset=utf-8";
  if (ext == "js" || ext == "mjs" || ext == "cjs") return "text/javascript; charset=utf-8";
  if (ext == "css") return "text/css; charset=utf-8";
  if (ext == "json" || ext == "map") return "application/json";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "jpg" || ext == "jpeg") return "image/jpeg";
  if (ext == "webp") return "image/webp";
  if (ext == "gif") return "image/gif";
  if (ext == "ico") return "image/x-icon";
  if (ext == "glb") return "model/gltf-binary";
  if (ext == "gltf") return "model/gltf+json";
  if (ext == "wasm") return "application/wasm";
  if (ext == "woff") return "font/woff";
  if (ext == "woff2") return "font/woff2";
  if (ext == "ttf") return "font/ttf";
  if (ext == "txt" || ext == "md" || ext == "gd" || ext == "gdshader" || ext == "tscn" ||
      ext == "import") {
    return "text/plain; charset=utf-8";
  }
  if (ext == "obj") return "text/plain; charset=utf-8";
  if (ext == "hdr") return "application/octet-stream";
  return "application/octet-stream";
}

bool iequals(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

bool is_websocket_upgrade(const std::string& request) {
  const std::string upgrade = header_value(request, "Upgrade");
  const std::string key = header_value(request, "Sec-WebSocket-Key");
  return iequals(upgrade, "websocket") || !key.empty();
}
}  // namespace

WebSocketServer::WebSocketServer(int port, std::string static_root)
    : port_(port), static_root_(std::move(static_root)) {
  while (static_root_.size() > 1 && static_root_.back() == '/') static_root_.pop_back();
}

WebSocketServer::~WebSocketServer() {
  for (auto& [id, client] : clients_) {
    if (client.file_fd >= 0) ::close(client.file_fd);
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
  if (!static_root_.empty() && is_dir(static_root_)) {
    std::cout << "[server] serving static files from " << static_root_ << std::endl;
  } else if (!static_root_.empty()) {
    std::cerr << "[server] static dir not found: " << static_root_
              << " (HTTP file serving disabled)" << std::endl;
    static_root_.clear();
  } else {
    std::cerr << "[server] no static dir configured (HTTP file serving disabled)" << std::endl;
  }
}

void WebSocketServer::poll_once(int timeout_ms) {
  reap_idle();
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

void WebSocketServer::mark_joined(Id id) {
  auto it = clients_.find(id);
  if (it == clients_.end()) return;
  it->second.joined = true;
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
#ifdef SO_NOSIGPIPE
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
#endif

    Client client;
    client.id = next_id_++;
    client.fd = fd;
    mark_activity(client);
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
    mark_activity(client);
    if (client.incoming.size() > kMaxIncoming) {
      drop(client, true);
      return;
    }
  }

  if (client.http) return;

  if (!client.handshake) {
    const Id id = client.id;
    complete_handshake(client);
    auto it = clients_.find(id);
    if (it == clients_.end() || !it->second.handshake) return;
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
      const Id id = client.id;
      queue_frame(client, 0xA, message);
      write_client(client);
      if (clients_.find(id) == clients_.end()) return;
      continue;
    }
    if (on_message) on_message(client.id, message);
    if (clients_.find(client.id) == clients_.end()) return;
  }
}

bool WebSocketServer::has_pending_write(const Client& client) const {
  return !client.outgoing.empty() || client.file_remaining > 0;
}

void WebSocketServer::fill_file_chunk(Client& client) {
  if (client.file_fd < 0 || client.file_remaining == 0) return;
  char buffer[kFileChunk];
  const size_t want = static_cast<size_t>(std::min<uint64_t>(kFileChunk, client.file_remaining));
  const ssize_t n = ::read(client.file_fd, buffer, want);
  if (n <= 0) {
    ::close(client.file_fd);
    client.file_fd = -1;
    client.file_remaining = 0;
    return;
  }
  client.outgoing.append(buffer, static_cast<size_t>(n));
  client.file_remaining -= static_cast<uint64_t>(n);
  if (client.file_remaining == 0) {
    ::close(client.file_fd);
    client.file_fd = -1;
  }
}

void WebSocketServer::write_client(Client& client) {
  const Id id = client.id;
  while (true) {
    if (clients_.find(id) == clients_.end()) return;
    if (client.outgoing.empty() && client.file_remaining > 0) fill_file_chunk(client);
    if (client.outgoing.empty()) break;
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
  if (clients_.find(id) == clients_.end()) return;
  if (client.http && !has_pending_write(client)) {
    drop(client, false);
    return;
  }
  rebuild_pollfds();
}

void WebSocketServer::queue_http(Client& client, int status, std::string_view reason,
                                 std::string_view content_type, std::string_view body,
                                 std::string_view extra_headers, bool head) {
  std::string response;
  response += "HTTP/1.1 ";
  response += std::to_string(status);
  response += " ";
  response += reason;
  response += "\r\nContent-Type: ";
  response += content_type;
  response += "\r\nContent-Length: ";
  response += std::to_string(body.size());
  response += "\r\nConnection: close\r\n";
  if (!extra_headers.empty()) response += extra_headers;
  response += "\r\n";
  if (!head) response.append(body.data(), body.size());
  client.http = true;
  client.outgoing.append(response);
  write_client(client);
}

void WebSocketServer::serve_file(Client& client, const std::string& path, uint64_t size,
                                 std::string_view mime, bool head_only, bool cache_immutable) {
  if (size > kMaxFileSize) {
    queue_http(client, 413, "Payload Too Large", "text/plain", "File too large");
    return;
  }

  int fd = -1;
  if (!head_only && size > 0) {
    fd = ::open(path.c_str(), O_RDONLY);
    if (fd < 0) {
      queue_http(client, 404, "Not Found", "text/plain", "Not Found");
      return;
    }
  }

  std::string headers;
  headers += "HTTP/1.1 200 OK\r\nContent-Type: ";
  headers += mime;
  headers += "\r\nContent-Length: ";
  headers += std::to_string(size);
  headers += "\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n";
  if (cache_immutable) {
    headers += "Cache-Control: public, max-age=31536000, immutable\r\n";
  } else if (mime.find("text/html") == 0) {
    headers += "Cache-Control: no-cache\r\n";
  } else {
    headers += "Cache-Control: public, max-age=3600\r\n";
  }
  headers += "\r\n";

  client.http = true;
  client.outgoing.append(headers);
  if (!head_only && fd >= 0) {
    client.file_fd = fd;
    client.file_remaining = size;
  }
  write_client(client);
}

void WebSocketServer::serve_static(Client& client, std::string_view method,
                                   std::string_view url_path) {
  const bool head_only = method == "HEAD";
  if (static_root_.empty()) {
    queue_http(client, 404, "Not Found", "text/plain", "Not Found");
    return;
  }

  std::string resolved;
  if (!resolve_under_root(static_root_, std::string(url_path), resolved)) {
    queue_http(client, 400, "Bad Request", "text/plain", "Bad Request");
    return;
  }

  std::string candidate = resolved;
  uint64_t size = 0;
  if (is_dir(candidate)) candidate += "/index.html";
  if (!is_reg(candidate, size)) {
    if (last_segment_has_extension(url_path)) {
      queue_http(client, 404, "Not Found", "text/plain", "Not Found");
      return;
    }
    candidate = static_root_ + "/index.html";
    if (!is_reg(candidate, size)) {
      queue_http(client, 404, "Not Found", "text/plain", "Not Found");
      return;
    }
  }

  if (!path_stays_in_root(static_root_, candidate)) {
    queue_http(client, 403, "Forbidden", "text/plain", "Forbidden");
    return;
  }

  const bool cache_immutable = url_path.starts_with("/assets/");
  serve_file(client, candidate, size, mime_for(candidate), head_only, cache_immutable);
}

void WebSocketServer::complete_handshake(Client& client) {
  const auto end = client.incoming.find("\r\n\r\n");
  if (end == std::string::npos) return;
  const std::string request = client.incoming.substr(0, end + 4);
  client.incoming.erase(0, end + 4);

  std::string method;
  std::string path;
  if (!parse_request_line(request, method, path)) {
    queue_http(client, 400, "Bad Request", "text/plain", "Bad Request");
    return;
  }

  const bool ws_upgrade = is_websocket_upgrade(request);
  if (ws_upgrade) {
    if (method != "GET" || (path != "/ws" && path != "/ws/")) {
      queue_http(client, 404, "Not Found", "text/plain", "Not Found");
      return;
    }
    const std::string key = header_value(request, "Sec-WebSocket-Key");
    if (key.empty()) {
      queue_http(client, 400, "Bad Request", "text/plain", "Missing Sec-WebSocket-Key");
      return;
    }

    const std::string accept = base64_encode(sha1::hash_bytes(key + std::string(kWsMagic)));
    const Id id = client.id;
    client.outgoing =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " +
        accept + "\r\n\r\n";
    write_client(client);
    auto it = clients_.find(id);
    if (it == clients_.end()) return;
    it->second.handshake = true;
    it->second.handshake_at = std::chrono::steady_clock::now();
    mark_activity(it->second);
    std::cout << "[server] client " << id << " connected" << std::endl;
    if (on_open) on_open(id);
    return;
  }

  const bool head = method == "HEAD";
  if (method != "GET" && !head) {
    queue_http(client, 405, "Method Not Allowed", "text/plain", "Method Not Allowed",
               "Allow: GET, HEAD\r\n", head);
    return;
  }

  if (path == "/health" || path == "/health/") {
    queue_http(client, 200, "OK", "text/plain", "OK", {}, head);
    return;
  }

  if (path == "/ws" || path == "/ws/") {
    queue_http(client, 426, "Upgrade Required", "text/plain", "Upgrade Required",
               "Upgrade: websocket\r\n", head);
    return;
  }

  serve_static(client, method, path);
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
  if (opcode == 0xA) {
    mark_activity(client);
    return extract_frame(client, message, is_close, is_ping);
  }
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
  if (client.file_fd >= 0) {
    ::close(client.file_fd);
    client.file_fd = -1;
  }
  client.file_remaining = 0;
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

void WebSocketServer::mark_activity(Client& client) {
  client.last_activity = std::chrono::steady_clock::now();
}

void WebSocketServer::reap_idle() {
  const auto now = std::chrono::steady_clock::now();
  std::vector<Id> dead;
  std::vector<Id> ping;
  for (auto& [id, client] : clients_) {
    if (client.handshake && !client.joined && now - client.handshake_at > kHelloTimeout) {
      dead.push_back(id);
      continue;
    }
    if (now - client.last_activity > kIdleTimeout) {
      dead.push_back(id);
      continue;
    }
    if (!client.handshake || !client.joined || client.closing || client.http) continue;
    if (now - client.last_ping >= kPingInterval && now - client.last_activity >= kPingInterval) {
      ping.push_back(id);
    }
  }
  for (Id id : ping) {
    auto it = clients_.find(id);
    if (it == clients_.end()) continue;
    queue_frame(it->second, 0x9, {});
    it->second.last_ping = now;
    write_client(it->second);
  }
  for (Id id : dead) {
    auto it = clients_.find(id);
    if (it == clients_.end()) continue;
    if (it->second.handshake && !it->second.joined) {
      std::cout << "[server] client " << id << " hello timeout" << std::endl;
    } else {
      std::cout << "[server] client " << id << " idle timeout" << std::endl;
    }
    drop(it->second, true);
  }
}

void WebSocketServer::rebuild_pollfds() {
  pollfds_.clear();
  pollfds_.push_back(pollfd{listen_fd_, POLLIN, 0});
  for (auto& [id, client] : clients_) {
    short events = POLLIN;
    if (has_pending_write(client)) events |= POLLOUT;
    pollfds_.push_back(pollfd{client.fd, events, 0});
  }
}
