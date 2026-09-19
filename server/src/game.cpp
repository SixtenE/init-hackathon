#include "game.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cctype>
#include <iostream>
#include <optional>
#include <sstream>

namespace {
constexpr float kWorldWidth = 140.0f;
constexpr float kWorldHeight = 120.0f;
constexpr float kGroundY = -kWorldHeight / 2.0f;
constexpr float kGearBottomOffset = 0.59f - 0.22f;
constexpr float kSpawnY = kGroundY + kGearBottomOffset + 0.02f;
constexpr float kSpawnZ = 0.0f;
constexpr float kMaxBank = 0.62f;
constexpr float kGravity = 9.81f;
constexpr float kCruiseSpeed = 16.0f;
constexpr float kThrottleRate = 0.45f;
constexpr float kMaxEngineAcceleration = 12.0f;
constexpr float kDragCoefficient = 0.026f;
constexpr float kLiftBaseAcceleration = kGravity * 0.18f;
constexpr float kLiftAoaAcceleration = kGravity * 3.6f;
constexpr float kMaxLiftAcceleration = kGravity * 2.4f;
constexpr float kPitchSpeed = 0.7f;
constexpr float kMaxPitch = 0.55f;
constexpr float kSideslipDamping = 2.4f;
constexpr float kMaxSafeLandingSpeed = 5.0f;
constexpr float kMaxSafeWallImpact = 5.0f;
constexpr float kLinearDamping = 0.015f;
constexpr float kAngularDamping = 0.18f;
constexpr float kMass = 1.0f;
constexpr float kInertia = 2.8f;
constexpr float kHalfPlayX = kWorldWidth / 2.0f - 6.2f;
constexpr float kMaxY = kWorldHeight / 2.0f - 4.0f;
constexpr float kAirborneEpsilon = 0.12f;
// Distance from the body origin to the main gear along -Z. Used so pitching
// on the runway rotates around the wheels instead of driving the tail into
// the ground.
constexpr float kMainGearArm = 5.7f;
// Constant runway deceleration. Must stay far below engine acceleration or
// the aircraft never reaches rotation speed.
constexpr float kRollingDeceleration = 0.45f;
constexpr float kWheelLateralDamping = 8.0f;
constexpr float kRotateSpeed = 10.0f;

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

std::optional<std::string> json_string(std::string_view json, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\"";
  auto pos = json.find(needle);
  if (pos == std::string_view::npos) return std::nullopt;
  pos = json.find(':', pos + needle.size());
  if (pos == std::string_view::npos) return std::nullopt;
  pos = json.find('"', pos + 1);
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

std::optional<int> json_int(std::string_view json, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\"";
  auto pos = json.find(needle);
  if (pos == std::string_view::npos) return std::nullopt;
  pos = json.find(':', pos + needle.size());
  if (pos == std::string_view::npos) return std::nullopt;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  try {
    size_t consumed = 0;
    const int value = std::stoi(std::string(json.substr(pos)), &consumed);
    return value;
  } catch (...) {
    return std::nullopt;
  }
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

void append_num(std::string& out, float value) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.4f", value);
  out += buf;
}

int clamp_axis(int value) { return value < 0 ? -1 : (value > 0 ? 1 : 0); }
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
  player.spawn += 1;
  player.position = {0.0f, kSpawnY, kSpawnZ};
  player.rotation = Quat::identity();
  player.linear_velocity = {};
  player.angular_velocity = {};
  player.throttle = 0;
  player.pitch_target = 0;
  player.angle_of_attack = 0;
  player.grounded = true;
  player.crashed = false;
  player.crash_reason.clear();
}

void GameWorld::crash(Player& player, std::string reason, float impact_speed) {
  if (player.crashed) return;
  player.crashed = true;
  player.crash_reason = std::move(reason);
  player.throttle = 0;
  const float impulse = kMass * std::min(impact_speed, 20.0f) * 0.08f;
  player.angular_velocity += Vec3{impulse * 0.35f, impulse * 0.2f, impulse} * (1.0f / kInertia);
  std::cout << "[world] crash player " << player.id << ": " << player.crash_reason << std::endl;
}

void GameWorld::handle_message(int id, std::string_view json) {
  auto it = players_.find(id);
  if (it == players_.end()) return;
  Player& player = it->second;
  const auto type = json_string(json, "type");
  if (!type) return;

  if (*type == "hello") {
    if (const auto name = json_string(json, "name")) {
      player.name = sanitize_name(*name);
    }
    return;
  }
  if (*type == "reset") {
    reset_player(player);
    return;
  }
  if (*type == "input") {
    PlayerInput input;
    input.throttle = clamp_axis(json_int(json, "throttle").value_or(0));
    input.turn = clamp_axis(json_int(json, "turn").value_or(0));
    input.pitch = clamp_axis(json_int(json, "pitch").value_or(0));
    input.seq = static_cast<uint32_t>(json_int(json, "seq").value_or(0));
    player.input = input;
  }
}

void GameWorld::simulate_player(Player& player, float dt) {
  const Vec3 forward = player.rotation.rotate({0, 0, 1}).normalized();
  const Vec3 up = player.rotation.rotate({0, 1, 0}).normalized();
  const Vec3 right = player.rotation.rotate({1, 0, 0}).normalized();

  if (!player.crashed) {
    player.throttle = clamp(player.throttle + float(player.input.throttle) * kThrottleRate * dt, 0.0f, 1.0f);
    if (player.input.pitch != 0) {
      player.pitch_target = clamp(
          player.pitch_target + float(player.input.pitch) * kPitchSpeed * dt, -kMaxPitch, kMaxPitch);
    } else {
      player.pitch_target = damp(player.pitch_target, 0.0f, 0.65f, dt);
    }
    // Keep the nose near level until there is enough speed to rotate. Holding
    // space from a standstill used to point the thrust vector up and stall the
    // takeoff roll.
    if (player.grounded) {
      const float forward_airspeed = std::max(0.0f, player.linear_velocity.dot(forward));
      const float rotate = clamp(forward_airspeed / kRotateSpeed, 0.0f, 1.0f);
      player.pitch_target = clamp(player.pitch_target, -0.04f, lerp(0.06f, kMaxPitch, rotate));
    }
  } else {
    player.throttle = 0;
    player.pitch_target = damp(player.pitch_target, 0.0f, 0.8f, dt);
  }

  Vec3 force{};
  Vec3 torque{};
  if (!player.crashed) {
    const float forward_airspeed = std::max(0.0f, player.linear_velocity.dot(forward));
    const float min_authority = player.grounded ? 0.45f : 0.15f;
    const float control_authority = clamp(forward_airspeed / kCruiseSpeed, min_authority, 1.25f);
    const float speed = player.linear_velocity.length();
    const float pitch_angle = std::asin(clamp(forward.y, -1.0f, 1.0f));
    const float flight_path_pitch =
        speed > 1.0f ? std::asin(clamp(player.linear_velocity.y / speed, -1.0f, 1.0f)) : 0.0f;
    const float aoa = clamp(pitch_angle - flight_path_pitch, -kMaxPitch, kMaxPitch);
    player.angle_of_attack = aoa;
    const float speed_ratio = forward_airspeed / kCruiseSpeed;
    const float lift_acceleration = clamp(
        speed_ratio * speed_ratio * (kLiftBaseAcceleration + kLiftAoaAcceleration * aoa),
        -kMaxLiftAcceleration, kMaxLiftAcceleration);
    const float sideslip = player.linear_velocity.dot(right);

    force += forward * (player.throttle * kMaxEngineAcceleration * kMass);
    force += up * (lift_acceleration * kMass);
    if (speed > 0.001f) {
      force += player.linear_velocity * (-kDragCoefficient * speed * kMass);
    }
    force += right * (-sideslip * kSideslipDamping * kMass);

    const float bank_angle = std::atan2(right.y, up.y);
    const float pitch_rate = player.angular_velocity.dot(right);
    const float roll_rate = player.angular_velocity.dot(forward);
    const float yaw_rate = player.angular_velocity.dot(up);
    const float pitch_error = player.pitch_target - pitch_angle;
    const float bank_error = -float(player.input.turn) * kMaxBank - bank_angle;

    torque += right * ((-pitch_error * 34.0f - pitch_rate * 9.0f) * kMass * control_authority);
    torque += forward * ((bank_error * 22.0f - roll_rate * 7.0f) * kMass * control_authority);
    torque += up * ((float(player.input.turn) * 6.0f * control_authority - yaw_rate * 1.5f) * kMass);
  }

  force.y += -kGravity * kMass;
  player.linear_velocity += force * (dt / kMass);
  player.linear_velocity = player.linear_velocity * (1.0f / (1.0f + kLinearDamping * dt));
  player.angular_velocity += torque * (dt / kInertia);
  player.angular_velocity = player.angular_velocity * (1.0f / (1.0f + kAngularDamping * dt));

  const Vec3 omega = player.angular_velocity;
  const Quat omega_q{omega.x, omega.y, omega.z, 0.0f};
  const Quat dq = Quat::mul(player.rotation, omega_q);
  player.rotation.x += dq.x * 0.5f * dt;
  player.rotation.y += dq.y * 0.5f * dt;
  player.rotation.z += dq.z * 0.5f * dt;
  player.rotation.w += dq.w * 0.5f * dt;
  player.rotation = player.rotation.normalized();

  player.position += player.linear_velocity * dt;

  const Vec3 grounded_forward = player.rotation.rotate({0, 0, 1}).normalized();
  const Vec3 grounded_right = player.rotation.rotate({1, 0, 0}).normalized();
  const float pitch_angle = std::asin(clamp(grounded_forward.y, -1.0f, 1.0f));
  const float rest_y = kSpawnY + kMainGearArm * std::max(0.0f, std::sin(pitch_angle));

  const bool was_grounded = player.grounded;
  if (player.position.y <= rest_y) {
    const float impact = std::max(0.0f, -player.linear_velocity.y);
    player.position.y = rest_y;
    if (!was_grounded && impact > kMaxSafeLandingSpeed) {
      crash(player, "Hard landing at " + [&] {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.1f u/s", impact);
        return std::string(buf);
      }(), impact);
    }
    if (player.linear_velocity.y < 0) player.linear_velocity.y = 0;

    const float lateral = player.linear_velocity.dot(grounded_right);
    player.linear_velocity += grounded_right * (-lateral * (1.0f - std::exp(-kWheelLateralDamping * dt)));
    if (player.linear_velocity.z > 0.0f) {
      player.linear_velocity.z = std::max(0.0f, player.linear_velocity.z - kRollingDeceleration * dt);
    } else {
      player.linear_velocity.z = std::min(0.0f, player.linear_velocity.z + kRollingDeceleration * dt);
    }
    player.grounded = true;
  } else {
    player.grounded = player.position.y <= rest_y + kAirborneEpsilon;
  }

  if (player.position.x > kHalfPlayX || player.position.x < -kHalfPlayX) {
    const float impact = std::abs(player.linear_velocity.x);
    player.position.x = clamp(player.position.x, -kHalfPlayX, kHalfPlayX);
    if (impact > kMaxSafeWallImpact) crash(player, "Collision with the wall", impact);
    player.linear_velocity.x = 0;
  }
  if (player.position.y > kMaxY) {
    const float impact = std::max(0.0f, player.linear_velocity.y);
    player.position.y = kMaxY;
    if (impact > kMaxSafeWallImpact) crash(player, "Collision with the ceiling", impact);
    player.linear_velocity.y = 0;
  }
}

void GameWorld::tick(float dt) {
  ++tick_;
  for (auto& [id, player] : players_) {
    simulate_player(player, dt);
  }
}

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
    append_num(out, player.linear_velocity.length());
    out += ",\"verticalSpeed\":";
    append_num(out, player.linear_velocity.y);
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
