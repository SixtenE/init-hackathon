#pragma once

#include <chrono>
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

  explicit WebSocketServer(int port, std::string static_root = {});
  ~WebSocketServer();

  WebSocketServer(const WebSocketServer&) = delete;
  WebSocketServer& operator=(const WebSocketServer&) = delete;

  void bind_and_listen();
  // Service sockets for up to timeout_ms. Returns after handling ready fds.
  void poll_once(int timeout_ms);
  void send_text(Id id, std::string_view message);
  void close_client(Id id);
  void mark_joined(Id id);

  std::function<void(Id)> on_open;
  std::function<void(Id)> on_close;
  std::function<void(Id, std::string_view)> on_message;

  size_t client_count() const { return clients_.size(); }

 private:
  struct Client {
    Id id = 0;
    int fd = -1;
    bool handshake = false;
    bool joined = false;
    bool closing = false;
    bool http = false;
    int file_fd = -1;
    uint64_t file_remaining = 0;
    std::string incoming;
    std::string outgoing;
    std::chrono::steady_clock::time_point last_activity{};
    std::chrono::steady_clock::time_point last_ping{};
    std::chrono::steady_clock::time_point handshake_at{};
  };

  void accept_new();
  void read_client(Client& client);
  void write_client(Client& client);
  void complete_handshake(Client& client);
  void serve_static(Client& client, std::string_view method, std::string_view url_path);
  void queue_http(Client& client, int status, std::string_view reason, std::string_view content_type,
                  std::string_view body, std::string_view extra_headers = {}, bool head = false);
  void serve_file(Client& client, const std::string& path, uint64_t size, std::string_view mime,
                  bool head_only, bool cache_immutable);
  void fill_file_chunk(Client& client);
  bool extract_frame(Client& client, std::string& message, bool& is_close, bool& is_ping);
  void queue_frame(Client& client, uint8_t opcode, std::string_view payload);
  void drop(Client& client, bool notify);
  void rebuild_pollfds();
  void reap_idle();
  void mark_activity(Client& client);
  bool has_pending_write(const Client& client) const;

  int port_ = 8080;
  std::string static_root_;
  int listen_fd_ = -1;
  int next_id_ = 1;
  std::unordered_map<Id, Client> clients_;
  std::vector<pollfd> pollfds_;
};
