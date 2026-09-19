#pragma once

#include <cstdint>
#include <string>

inline std::string base64_encode(const std::string& input) {
  static constexpr char kTable[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  size_t i = 0;
  while (i + 2 < input.size()) {
    const uint32_t n = (uint8_t(input[i]) << 16) | (uint8_t(input[i + 1]) << 8) |
                       uint8_t(input[i + 2]);
    out.push_back(kTable[(n >> 18) & 63]);
    out.push_back(kTable[(n >> 12) & 63]);
    out.push_back(kTable[(n >> 6) & 63]);
    out.push_back(kTable[n & 63]);
    i += 3;
  }
  if (i < input.size()) {
    uint32_t n = uint8_t(input[i]) << 16;
    if (i + 1 < input.size()) n |= uint8_t(input[i + 1]) << 8;
    out.push_back(kTable[(n >> 18) & 63]);
    out.push_back(kTable[(n >> 12) & 63]);
    out.push_back(i + 1 < input.size() ? kTable[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}
