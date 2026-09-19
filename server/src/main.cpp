#include "game.hpp"
#include "websocket.hpp"

#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>

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

  const int port = parse_port(argc, argv);
  GameWorld world;
  WebSocketServer server(port);

  server.on_open = [&](WebSocketServer::Id id) {
    if (!world.spawn(id)) {
      std::cerr << "[server] world full, rejecting client " << id << std::endl;
      server.close_client(id);
      return;
    }
    server.send_text(id, world.serialize_welcome(id));
    server.send_text(id, world.serialize_state());
  };
  server.on_close = [&](WebSocketServer::Id id) { world.despawn(id); };
  server.on_message = [&](WebSocketServer::Id id, std::string_view message) {
    world.handle_message(id, message);
  };

  try {
    server.bind_and_listen();
  } catch (const std::exception& ex) {
    std::cerr << "[server] " << ex.what() << std::endl;
    return 1;
  }

  using clock = std::chrono::steady_clock;
  auto next_tick = clock::now();
  const auto tick_dt = std::chrono::duration_cast<clock::duration>(
      std::chrono::duration<float>(GameWorld::kTickDt));

  std::cout << "[server] tick=" << int(1.0f / GameWorld::kTickDt)
            << "Hz snapshots=" << int(1.0f / GameWorld::kTickDt / 3.0f) << "Hz" << std::endl;

  while (g_running) {
    const auto now = clock::now();
    int wait_ms = 1;
    if (now < next_tick) {
      wait_ms = std::max(
          1, int(std::chrono::duration_cast<std::chrono::milliseconds>(next_tick - now).count()));
    }
    try {
      server.poll_once(wait_ms);
    } catch (const std::exception& ex) {
      std::cerr << "[server] poll error: " << ex.what() << std::endl;
      return 1;
    }

    int steps = 0;
    while (clock::now() >= next_tick && steps < 5) {
      world.tick(GameWorld::kTickDt);
      next_tick += tick_dt;
      ++steps;
      if (world.tick_count() % 3 == 0) {
        const std::string state = world.serialize_state();
        for (int id : world.player_ids()) server.send_text(id, state);
      }
    }
    if (steps == 5) next_tick = clock::now();
  }

  std::cout << "[server] shutting down" << std::endl;
  return 0;
}
