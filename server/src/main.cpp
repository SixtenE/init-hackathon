#include "game.hpp"
#include "websocket.hpp"

#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>

// Client-authoritative relay, matching jump-prince:
//   Client -> Server: hello, pose (~20Hz), reset
//   Server -> Client: welcome (id + existing players), join, leave, state (~20Hz)
// Physics stays on the client; this process only assigns ids and relays poses.

namespace {
volatile std::sig_atomic_t g_running = 1;

void handle_signal(int) { g_running = 0; }

int parse_port(int argc, char** argv) {
  if (const char* env = std::getenv("GAME_SERVER_PORT")) {
    const int port = std::atoi(env);
    if (port > 0 && port < 65536) return port;
  }
  if (argc > 1) {
    const int port = std::atoi(argv[1]);
    if (port > 0 && port < 65536) return port;
  }
  return 8080;
}
}  // namespace

int main(int argc, char** argv) {
  std::signal(SIGINT, handle_signal);
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGPIPE, SIG_IGN);

  const int port = parse_port(argc, argv);
  GameWorld world;
  WebSocketServer server(port);

  auto broadcast = [&](const std::string& payload, int except_id = -1) {
    for (int id : world.player_ids()) {
      if (id != except_id) server.send_text(id, payload);
    }
  };

  server.on_open = [&](WebSocketServer::Id id) {
    if (server.client_count() > static_cast<size_t>(GameWorld::kMaxPlayers) * 2) {
      std::cerr << "[server] too many sockets, rejecting client " << id << std::endl;
      server.close_client(id);
    }
  };
  server.on_close = [&](WebSocketServer::Id id) {
    if (!world.contains(id)) return;
    world.despawn(id);
    broadcast(world.serialize_leave(id));
  };
  server.on_message = [&](WebSocketServer::Id id, std::string_view message) {
    const auto event = world.handle_message(id, message);
    if (const auto kicked = world.take_displaced()) {
      std::cout << "[server] replacing stale session client " << *kicked << std::endl;
      broadcast(world.serialize_leave(*kicked));
      server.close_client(*kicked);
    }
    if (event == GameWorld::Event::Rejected) {
      std::cerr << "[server] world full, rejecting client " << id << std::endl;
      server.close_client(id);
      return;
    }
    if (event == GameWorld::Event::Joined) {
      server.mark_joined(id);
      server.send_text(id, world.serialize_welcome(id));
      broadcast(world.serialize_join(id), id);
      return;
    }
    if (event == GameWorld::Event::Reset) {
      broadcast(world.serialize_state());
    }
  };

  try {
    server.bind_and_listen();
  } catch (const std::exception& ex) {
    std::cerr << "[server] " << ex.what() << std::endl;
    return 1;
  }

  using clock = std::chrono::steady_clock;
  auto next_snapshot = clock::now();
  const auto snapshot_dt = std::chrono::duration_cast<clock::duration>(
      std::chrono::duration<float>(GameWorld::kSnapshotDt));

  std::cout << "[server] physics=client snapshots="
            << int(1.0f / GameWorld::kSnapshotDt) << "Hz" << std::endl;

  while (g_running) {
    const auto now = clock::now();
    int wait_ms = 1;
    if (now < next_snapshot) {
      wait_ms = std::max(
          1, int(std::chrono::duration_cast<std::chrono::milliseconds>(next_snapshot - now)
                     .count()));
    }
    try {
      server.poll_once(wait_ms);
    } catch (const std::exception& ex) {
      std::cerr << "[server] poll error: " << ex.what() << std::endl;
      return 1;
    }

    if (clock::now() >= next_snapshot) {
      world.tick();
      if (world.player_count() > 0) {
        const std::string state = world.serialize_state();
        for (int id : world.player_ids()) server.send_text(id, state);
      }
      next_snapshot += snapshot_dt;
      if (next_snapshot < clock::now() - snapshot_dt) next_snapshot = clock::now();
    }
  }

  std::cout << "[server] shutting down" << std::endl;
  return 0;
}
