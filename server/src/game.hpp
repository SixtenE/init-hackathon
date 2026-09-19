#pragma once

#include "vec.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

struct PlayerInput {
  int throttle = 0;
  int turn = 0;
  int pitch = 0;
  uint32_t seq = 0;
};

struct Player {
  int id = 0;
  std::string name;
  uint32_t spawn = 0;
  Vec3 position;
  Quat rotation;
  Vec3 linear_velocity;
  Vec3 angular_velocity;
  float throttle = 0;
  float pitch_target = 0;
  float angle_of_attack = 0;
  bool grounded = true;
  bool crashed = false;
  std::string crash_reason;
  PlayerInput input;
};

class GameWorld {
 public:
  static constexpr float kTickDt = 1.0f / 60.0f;
  static constexpr int kMaxPlayers = 16;

  bool spawn(int id);
  void despawn(int id);
  void handle_message(int id, std::string_view json);
  void tick(float dt);
  std::string serialize_welcome(int id) const;
  std::string serialize_state() const;
  uint32_t tick_count() const { return tick_; }
  size_t player_count() const { return players_.size(); }
  std::vector<int> player_ids() const;

 private:
  void reset_player(Player& player);
  void simulate_player(Player& player, float dt);
  void crash(Player& player, std::string reason, float impact_speed);

  uint32_t tick_ = 0;
  std::unordered_map<int, Player> players_;
};
