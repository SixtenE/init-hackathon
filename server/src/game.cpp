#include "game.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <optional>
#include <sstream>

namespace {
constexpr float kWorldHeight = 120.0f;
constexpr float kGroundY = -kWorldHeight / 2.0f;
constexpr float kGearBottomOffset = 0.59f - 0.22f;
constexpr float kSpawnY = kGroundY + kGearBottomOffset + 0.02f;
constexpr float kSpawnZ = 0.0f;
constexpr float kMaxAbsValue = 1.0e6f;

std::string json_escape(std::string_view value) {
  std::string out;
  out.reserve(value.size());
  for (char c : value) {
    switch (c) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      default:
        if (static_cast<unsigned char>(c) < 32) break;
        out.push_back(c);
    }
  }
  return out;
}

size_t find_key(std::string_view json, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\":";
  return json.find(needle);
}

std::optional<std::string> json_string(std::string_view json, std::string_view key) {
  auto pos = find_key(json, key);
  if (pos == std::string_view::npos) return std::nullopt;
  pos = json.find('"', pos + key.size() + 3);
  if (pos == std::string_view::npos) return std::nullopt;
  ++pos;
  std::string out;
  for (; pos < json.size(); ++pos) {
    const char c = json[pos];
    if (c == '"') return out;
    if (c == '\\' && pos + 1 < json.size()) {
      ++pos;
      out.push_back(json[pos] == 'n' ? '\n' : json[pos]);
      continue;
    }
    out.push_back(c);
  }
  return std::nullopt;
}

std::optional<double> json_number(std::string_view json, std::string_view key) {
  auto pos = find_key(json, key);
  if (pos == std::string_view::npos) return std::nullopt;
  pos += key.size() + 3;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  try {
    size_t consumed = 0;
    const double value = std::stod(std::string(json.substr(pos)), &consumed);
    if (consumed == 0 || !std::isfinite(value)) return std::nullopt;
    return value;
  } catch (...) {
    return std::nullopt;
  }
}

std::optional<bool> json_bool(std::string_view json, std::string_view key) {
  auto pos = find_key(json, key);
  if (pos == std::string_view::npos) return std::nullopt;
  pos += key.size() + 3;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  if (json.substr(pos, 4) == "true") return true;
  if (json.substr(pos, 5) == "false") return false;
  return std::nullopt;
}

std::string sanitize_name(std::string name) {
  name.erase(std::remove_if(name.begin(), name.end(),
                            [](unsigned char c) {
                              return !(std::isalnum(c) || c == ' ' || c == '-' || c == '_');
                            }),
              name.end());
  if (name.size() > 20) name.resize(20);
  while (!name.empty() && std::isspace(static_cast<unsigned char>(name.front()))) name.erase(name.begin());
  while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) name.pop_back();
  if (name.empty()) name = "Pilot";
  return name;
}

std::string sanitize_reason(std::string reason) {
  reason.erase(std::remove_if(reason.begin(), reason.end(),
                              [](unsigned char c) { return c < 32; }),
               reason.end());
  if (reason.size() > 80) reason.resize(80);
  return reason;
}

void append_num(std::string& out, float value) {
  if (!std::isfinite(value)) value = 0;
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.4f", value);
  out += buf;
}

bool finite_in_range(double value) {
  return std::isfinite(value) && std::fabs(value) <= kMaxAbsValue;
}

std::optional<float> pose_float(std::string_view json, std::string_view key) {
  const auto value = json_number(json, key);
  if (!value || !finite_in_range(*value)) return std::nullopt;
  return static_cast<float>(*value);
}
}  // namespace

bool GameWorld::spawn(int id) {
  if (players_.size() >= kMaxPlayers) return false;
  if (players_.contains(id)) return true;
  Player player;
  player.id = id;
  player.name = "Pilot-" + std::to_string(id);
  reset_player(player);
  players_.emplace(id, player);
  std::cout << "[world] spawn " << player.name << " (" << id << ")" << std::endl;
  return true;
}

void GameWorld::despawn(int id) {
  auto it = players_.find(id);
  if (it == players_.end()) return;
  std::cout << "[world] despawn " << it->second.name << " (" << id << ")" << std::endl;
  players_.erase(it);
}

void GameWorld::reset_player(Player& player) {
  player.seq = 0;
  player.position = {0.0f, kSpawnY, kSpawnZ};
  player.rotation = {};
  player.linear_velocity = {};
  player.throttle = 0;
  player.airspeed = 0;
  player.vertical_speed = 0;
  player.angle_of_attack = 0;
  player.grounded = true;
  player.crashed = false;
  player.has_pose = false;
  player.crash_reason.clear();
}

bool GameWorld::handle_message(int id, std::string_view json) {
  auto it = players_.find(id);
  if (it == players_.end()) return false;
  Player& player = it->second;
  const auto type = json_string(json, "type");
  if (!type) return false;

  if (*type == "hello") {
    if (const auto name = json_string(json, "name")) {
      player.name = sanitize_name(*name);
      return true;
    }
    return false;
  }

  if (*type == "reset") {
    const uint32_t spawn = player.spawn;
    reset_player(player);
    player.spawn = spawn;
    return true;
  }

  if (*type != "pose") return false;

  const auto x = pose_float(json, "x");
  const auto y = pose_float(json, "y");
  const auto z = pose_float(json, "z");
  if (!x || !y || !z) return false;

  const uint32_t spawn = static_cast<uint32_t>(json_number(json, "spawn").value_or(player.spawn));
  const uint32_t seq = static_cast<uint32_t>(json_number(json, "seq").value_or(0));
  if (spawn < player.spawn) return false;
  if (spawn == player.spawn && seq != 0 && seq < player.seq) return false;

  player.spawn = spawn;
  player.seq = seq;
  player.position = {*x, *y, *z};
  player.rotation.x = pose_float(json, "qx").value_or(0);
  player.rotation.y = pose_float(json, "qy").value_or(0);
  player.rotation.z = pose_float(json, "qz").value_or(0);
  player.rotation.w = pose_float(json, "qw").value_or(1);
  const float qlen = std::sqrt(player.rotation.x * player.rotation.x +
                               player.rotation.y * player.rotation.y +
                               player.rotation.z * player.rotation.z +
                               player.rotation.w * player.rotation.w);
  if (qlen > 1e-6f) {
    player.rotation.x /= qlen;
    player.rotation.y /= qlen;
    player.rotation.z /= qlen;
    player.rotation.w /= qlen;
  } else {
    player.rotation = {};
  }
  player.linear_velocity.x = pose_float(json, "vx").value_or(0);
  player.linear_velocity.y = pose_float(json, "vy").value_or(0);
  player.linear_velocity.z = pose_float(json, "vz").value_or(0);
  player.throttle = std::clamp(pose_float(json, "throttle").value_or(player.throttle), 0.0f, 1.0f);
  player.airspeed = std::max(0.0f, pose_float(json, "airspeed").value_or(player.airspeed));
  player.vertical_speed = pose_float(json, "verticalSpeed").value_or(player.vertical_speed);
  player.angle_of_attack = pose_float(json, "angleOfAttack").value_or(player.angle_of_attack);
  player.grounded = json_bool(json, "grounded").value_or(player.grounded);
  player.crashed = json_bool(json, "crashed").value_or(player.crashed);
  if (player.crashed) {
    if (const auto reason = json_string(json, "crashReason")) {
      player.crash_reason = sanitize_reason(*reason);
    }
  } else {
    player.crash_reason.clear();
  }
  player.has_pose = true;
  return true;
}

void GameWorld::tick() { ++tick_; }

std::vector<int> GameWorld::player_ids() const {
  std::vector<int> ids;
  ids.reserve(players_.size());
  for (const auto& [id, player] : players_) ids.push_back(id);
  return ids;
}

std::string GameWorld::serialize_welcome(int id) const {
  std::ostringstream out;
  out << "{\"type\":\"welcome\",\"id\":" << id << ",\"tick\":" << tick_ << "}";
  return out.str();
}

std::string GameWorld::serialize_state() const {
  std::string out = "{\"type\":\"state\",\"tick\":";
  out += std::to_string(tick_);
  out += ",\"players\":[";
  bool first = true;
  for (const auto& [id, player] : players_) {
    if (!first) out += ',';
    first = false;
    out += "{\"id\":";
    out += std::to_string(player.id);
    out += ",\"name\":\"";
    out += json_escape(player.name);
    out += "\",\"spawn\":";
    out += std::to_string(player.spawn);
    out += ",\"x\":";
    append_num(out, player.position.x);
    out += ",\"y\":";
    append_num(out, player.position.y);
    out += ",\"z\":";
    append_num(out, player.position.z);
    out += ",\"qx\":";
    append_num(out, player.rotation.x);
    out += ",\"qy\":";
    append_num(out, player.rotation.y);
    out += ",\"qz\":";
    append_num(out, player.rotation.z);
    out += ",\"qw\":";
    append_num(out, player.rotation.w);
    out += ",\"vx\":";
    append_num(out, player.linear_velocity.x);
    out += ",\"vy\":";
    append_num(out, player.linear_velocity.y);
    out += ",\"vz\":";
    append_num(out, player.linear_velocity.z);
    out += ",\"throttle\":";
    append_num(out, player.throttle);
    out += ",\"airspeed\":";
    append_num(out, player.airspeed);
    out += ",\"verticalSpeed\":";
    append_num(out, player.vertical_speed);
    out += ",\"angleOfAttack\":";
    append_num(out, player.angle_of_attack);
    out += ",\"grounded\":";
    out += player.grounded ? "true" : "false";
    out += ",\"crashed\":";
    out += player.crashed ? "true" : "false";
    if (player.crashed) {
      out += ",\"crashReason\":\"";
      out += json_escape(player.crash_reason);
      out += '"';
    }
    out += '}';
  }
  out += "]}";
  return out;
}
