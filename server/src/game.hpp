#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

struct Vec3 {
  float x = 0;
  float y = 0;
  float z = 0;
};

struct Quat {
  float x = 0;
  float y = 0;
  float z = 0;
  float w = 1;
};

struct Player {
  int id = 0;
  std::string name;
  uint32_t spawn = 0;
  uint32_t seq = 0;
  Vec3 position;
  Quat rotation;
  Vec3 linear_velocity;
  float throttle = 0;
  float airspeed = 0;
  float vertical_speed = 0;
  float angle_of_attack = 0;
  bool grounded = false;
  bool crashed = false;
  bool has_pose = false;
  bool joined = false;
  std::string crash_reason;
  std::string session;
};

class GameWorld {
 public:
  static constexpr float kSnapshotDt = 1.0f / 20.0f;
  static constexpr int kMaxPlayers = 16;

  enum class Event { Ignored, Joined, Reset, Rejected };

  bool spawn(int id);
  void despawn(int id);
  bool contains(int id) const { return players_.contains(id); }
  Event handle_message(int id, std::string_view json);
  void tick();
  std::string serialize_welcome(int id) const;
  std::string serialize_join(int id) const;
  std::string serialize_leave(int id) const;
  std::string serialize_state() const;
  uint32_t tick_count() const { return tick_; }
  size_t player_count() const { return players_.size(); }
  std::vector<int> player_ids() const;
  std::optional<int> take_displaced();

 private:
  void reset_player(Player& player);
  void append_player(std::string& out, const Player& player) const;

  uint32_t tick_ = 0;
  std::optional<int> displaced_id_;
  std::unordered_map<int, Player> players_;
};
