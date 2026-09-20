#include "game.hpp"

#include "json.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <optional>

namespace {
constexpr float kWorldHeight = 360.0f;
constexpr float kGroundY = -kWorldHeight / 2.0f;
constexpr float kSpawnAltitude = 42.0f;
constexpr float kSpawnY = kGroundY + kSpawnAltitude;
constexpr float kSpawnZ = 0.0f;
constexpr float kSpawnAirspeed = 250.0f * 0.514444f / 3.0f;
constexpr float kSpawnThrottle = (250.0f / 330.0f) * (250.0f / 330.0f);
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

std::string sanitize_session(std::string session) {
  session.erase(std::remove_if(session.begin(), session.end(),
                               [](unsigned char c) {
                                 return !(std::isalnum(c) || c == '-' || c == '_');
                               }),
                session.end());
  if (session.size() > 64) session.resize(64);
  return session;
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

std::optional<float> pose_float(const json::Value& v, const char* key) {
  const json::Value* field = v.find(key);
  if (!field || !field->isNum() || !finite_in_range(field->num)) return std::nullopt;
  return static_cast<float>(field->num);
}

std::optional<bool> pose_bool(const json::Value& v, const char* key) {
  const json::Value* field = v.find(key);
  if (!field || !field->isBool()) return std::nullopt;
  return field->b;
}

std::optional<json::Value> parse_message(std::string_view json) {
  try {
    return json::parse(std::string(json));
  } catch (const std::exception& ex) {
    std::cerr << "[world] bad JSON: " << ex.what() << std::endl;
    return std::nullopt;
  }
}
}  // namespace

bool GameWorld::spawn(int id) {
  if (players_.contains(id)) return true;
  if (players_.size() >= kMaxPlayers) return false;
  Player player;
  player.id = id;
  player.name = "Pilot-" + std::to_string(id);
  player.joined = false;
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
  player.linear_velocity = {0.0f, 0.0f, kSpawnAirspeed};
  player.throttle = kSpawnThrottle;
  player.airspeed = kSpawnAirspeed;
  player.vertical_speed = 0;
  player.angle_of_attack = 0;
  player.grounded = false;
  player.crashed = false;
  player.has_pose = false;
  player.crash_reason.clear();
}

GameWorld::Event GameWorld::handle_message(int id, std::string_view raw) {
  const auto parsed = parse_message(raw);
  if (!parsed || !parsed->isObj()) return Event::Ignored;
  const json::Value& v = *parsed;

  const json::Value* typeV = v.find("type");
  if (!typeV || !typeV->isStr()) return Event::Ignored;
  const std::string& type = typeV->str;

  if (type == "hello") {
    std::string session;
    if (const json::Value* sessionV = v.find("session"); sessionV && sessionV->isStr()) {
      session = sanitize_session(sessionV->str);
    }
    if (!session.empty()) {
      for (const auto& [other_id, other] : players_) {
        if (other_id != id && other.session == session) {
          displaced_id_ = other_id;
          break;
        }
      }
      if (displaced_id_) despawn(*displaced_id_);
    }
    if (!spawn(id)) return Event::Rejected;
    auto it = players_.find(id);
    if (it == players_.end()) return Event::Rejected;
    Player& player = it->second;
    if (const json::Value* nameV = v.find("name"); nameV && nameV->isStr()) {
      player.name = sanitize_name(nameV->str);
    }
    player.session = std::move(session);
    if (player.joined) return Event::Ignored;
    player.joined = true;
    return Event::Joined;
  }

  auto it = players_.find(id);
  if (it == players_.end() || !it->second.joined) return Event::Ignored;
  Player& player = it->second;

  if (type == "reset") {
    const uint32_t next_spawn = player.spawn + 1;
    reset_player(player);
    player.spawn = next_spawn;
    return Event::Reset;
  }

  if (type != "pose") return Event::Ignored;

  const auto x = pose_float(v, "x");
  const auto y = pose_float(v, "y");
  const auto z = pose_float(v, "z");
  if (!x || !y || !z) return Event::Ignored;

  const json::Value* spawnV = v.find("spawn");
  const json::Value* seqV = v.find("seq");
  const uint32_t spawn = static_cast<uint32_t>(
      spawnV && spawnV->isNum() ? spawnV->num : player.spawn);
  const uint32_t seq = static_cast<uint32_t>(seqV && seqV->isNum() ? seqV->num : 0);
  if (spawn < player.spawn) return Event::Ignored;
  if (spawn == player.spawn && seq != 0 && seq < player.seq) return Event::Ignored;

  player.spawn = spawn;
  player.seq = seq;
  player.position = {*x, *y, *z};
  player.rotation.x = pose_float(v, "qx").value_or(0);
  player.rotation.y = pose_float(v, "qy").value_or(0);
  player.rotation.z = pose_float(v, "qz").value_or(0);
  player.rotation.w = pose_float(v, "qw").value_or(1);
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
  player.linear_velocity.x = pose_float(v, "vx").value_or(0);
  player.linear_velocity.y = pose_float(v, "vy").value_or(0);
  player.linear_velocity.z = pose_float(v, "vz").value_or(0);
  player.throttle = std::clamp(pose_float(v, "throttle").value_or(player.throttle), 0.0f, 1.0f);
  player.airspeed = std::max(0.0f, pose_float(v, "airspeed").value_or(player.airspeed));
  player.vertical_speed = pose_float(v, "verticalSpeed").value_or(player.vertical_speed);
  player.angle_of_attack = pose_float(v, "angleOfAttack").value_or(player.angle_of_attack);
  player.grounded = pose_bool(v, "grounded").value_or(player.grounded);
  player.crashed = pose_bool(v, "crashed").value_or(player.crashed);
  if (player.crashed) {
    if (const json::Value* reason = v.find("crashReason"); reason && reason->isStr()) {
      player.crash_reason = sanitize_reason(reason->str);
    }
  } else {
    player.crash_reason.clear();
  }
  player.has_pose = true;
  return Event::Ignored;
}

void GameWorld::tick() { ++tick_; }

std::vector<int> GameWorld::player_ids() const {
  std::vector<int> ids;
  ids.reserve(players_.size());
  for (const auto& [id, player] : players_) {
    if (player.joined) ids.push_back(id);
  }
  return ids;
}

std::optional<int> GameWorld::take_displaced() {
  auto id = displaced_id_;
  displaced_id_.reset();
  return id;
}

void GameWorld::append_player(std::string& out, const Player& player) const {
  out += "{\"id\":";
  out += std::to_string(player.id);
  out += ",\"name\":\"";
  out += json_escape(player.name);
  out += "\",\"seq\":";
  out += std::to_string(player.seq);
  out += ",\"spawn\":";
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

std::string GameWorld::serialize_welcome(int id) const {
  std::string out = "{\"type\":\"welcome\",\"id\":";
  out += std::to_string(id);
  out += ",\"tick\":";
  out += std::to_string(tick_);
  out += ",\"players\":[";
  bool first = true;
  for (const auto& [pid, player] : players_) {
    if (!player.joined || pid == id) continue;
    if (!first) out += ',';
    first = false;
    append_player(out, player);
  }
  out += "]}";
  return out;
}

std::string GameWorld::serialize_join(int id) const {
  auto it = players_.find(id);
  if (it == players_.end()) return "{\"type\":\"join\",\"player\":null}";
  std::string out = "{\"type\":\"join\",\"player\":";
  append_player(out, it->second);
  out += '}';
  return out;
}

std::string GameWorld::serialize_leave(int id) const {
  return "{\"type\":\"leave\",\"id\":" + std::to_string(id) + "}";
}

std::string GameWorld::serialize_state() const {
  std::string out = "{\"type\":\"state\",\"tick\":";
  out += std::to_string(tick_);
  out += ",\"players\":[";
  bool first = true;
  for (const auto& [id, player] : players_) {
    if (!player.joined) continue;
    if (!first) out += ',';
    first = false;
    append_player(out, player);
  }
  out += "]}";
  return out;
}
