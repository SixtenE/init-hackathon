#pragma once

#include <cmath>

struct Vec3 {
  float x = 0;
  float y = 0;
  float z = 0;

  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
  Vec3 operator-() const { return {-x, -y, -z}; }
  Vec3& operator+=(const Vec3& o) {
    x += o.x;
    y += o.y;
    z += o.z;
    return *this;
  }

  float dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
  float length_sq() const { return dot(*this); }
  float length() const { return std::sqrt(length_sq()); }

  Vec3 normalized() const {
    const float len = length();
    return len > 1e-8f ? (*this) * (1.0f / len) : Vec3{};
  }
};

inline Vec3 operator*(float s, const Vec3& v) { return v * s; }

struct Quat {
  float x = 0;
  float y = 0;
  float z = 0;
  float w = 1;

  static Quat identity() { return {}; }

  static Quat mul(const Quat& a, const Quat& b) {
    return {
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  Vec3 rotate(const Vec3& v) const {
    const Vec3 qv{x, y, z};
    const Vec3 t = Vec3{
        (qv.y * v.z - qv.z * v.y) * 2.0f,
        (qv.z * v.x - qv.x * v.z) * 2.0f,
        (qv.x * v.y - qv.y * v.x) * 2.0f,
    };
    return {
        v.x + w * t.x + (qv.y * t.z - qv.z * t.y),
        v.y + w * t.y + (qv.z * t.x - qv.x * t.z),
        v.z + w * t.z + (qv.x * t.y - qv.y * t.x),
    };
  }

  Quat normalized() const {
    const float len = std::sqrt(x * x + y * y + z * z + w * w);
    if (len < 1e-8f) return identity();
    const float inv = 1.0f / len;
    return {x * inv, y * inv, z * inv, w * inv};
  }
};

inline float clamp(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }

inline float damp(float current, float target, float lambda, float dt) {
  return lerp(current, target, 1.0f - std::exp(-lambda * dt));
}
