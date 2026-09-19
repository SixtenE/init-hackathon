#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include <poll.h>

class WebSocketServer {
 public:
  using Id = int;

  explicit WebSocketServer(int port);
  ~WebSocketServer();

  WebSocketServer(const WebSocketServer&) = delete;
  WebSocketServer& operator=(const WebSocketServer&) = delete;

  void bind_and_listen();
  // Service sockets for up to timeout_ms. Returns after handling ready fds.
  void poll_once(int timeout_ms);
  void send_text(Id id, std::string_view message);
  void close_client(Id id);

  std::function<void(Id)> on_open;
  std::function<void(Id)> on_close;
  std::function<void(Id, std::string_view)> on_message;

  size_t client_count() const { return clients_.size(); }

 private:
  struct Client {
    Id id = 0;
    int fd = -1;
    bool handshake = false;
    bool closing = false;
    std::string incoming;
    std::string outgoing;
  };

  void accept_new();
  void read_client(Client& client);
  void write_client(Client& client);
  void complete_handshake(Client& client);
  bool extract_frame(Client& client, std::string& message, bool& is_close, bool& is_ping);
  void queue_frame(Client& client, uint8_t opcode, std::string_view payload);
  void drop(Client& client, bool notify);
  void rebuild_pollfds();

  int port_ = 8080;
  int listen_fd_ = -1;
  int next_id_ = 1;
  std::unordered_map<Id, Client> clients_;
  std::vector<pollfd> pollfds_;
};
