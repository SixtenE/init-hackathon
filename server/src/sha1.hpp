#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>

// Public-domain SHA-1 (FIPS 180-1) for the WebSocket handshake.
namespace sha1 {
inline uint32_t rol(uint32_t value, int bits) {
  return (value << bits) | (value >> (32 - bits));
}

inline void hash(const uint8_t* data, size_t length, uint8_t out[20]) {
  uint32_t h0 = 0x67452301u;
  uint32_t h1 = 0xEFCDAB89u;
  uint32_t h2 = 0x98BADCFEu;
  uint32_t h3 = 0x10325476u;
  uint32_t h4 = 0xC3D2E1F0u;

  const uint64_t bit_len = static_cast<uint64_t>(length) * 8;
  const size_t padded = ((length + 9 + 63) / 64) * 64;
  uint8_t block[128];
  uint32_t w[80];

  for (size_t offset = 0; offset < padded; offset += 64) {
    std::memset(block, 0, 64);
    if (offset < length) {
      const size_t copy = length - offset < 64 ? length - offset : 64;
      std::memcpy(block, data + offset, copy);
      if (copy < 64) block[copy] = 0x80;
    } else if (offset == length) {
      block[0] = 0x80;
    }
    if (offset + 64 == padded) {
      for (int i = 0; i < 8; ++i) {
        block[56 + i] = static_cast<uint8_t>(bit_len >> (56 - 8 * i));
      }
    }

    for (int i = 0; i < 16; ++i) {
      w[i] = (uint32_t(block[i * 4]) << 24) | (uint32_t(block[i * 4 + 1]) << 16) |
             (uint32_t(block[i * 4 + 2]) << 8) | uint32_t(block[i * 4 + 3]);
    }
    for (int i = 16; i < 80; ++i) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
    for (int i = 0; i < 80; ++i) {
      uint32_t f, k;
      if (i < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5A827999u;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1u;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDCu;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6u;
      }
      const uint32_t temp = rol(a, 5) + f + e + k + w[i];
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }
    h0 += a;
    h1 += b;
    h2 += c;
    h3 += d;
    h4 += e;
  }

  const uint32_t hs[5] = {h0, h1, h2, h3, h4};
  for (int i = 0; i < 5; ++i) {
    out[i * 4] = static_cast<uint8_t>(hs[i] >> 24);
    out[i * 4 + 1] = static_cast<uint8_t>(hs[i] >> 16);
    out[i * 4 + 2] = static_cast<uint8_t>(hs[i] >> 8);
    out[i * 4 + 3] = static_cast<uint8_t>(hs[i]);
  }
}

inline std::string hash_bytes(const std::string& input) {
  uint8_t digest[20];
  hash(reinterpret_cast<const uint8_t*>(input.data()), input.size(), digest);
  return std::string(reinterpret_cast<char*>(digest), 20);
}
}  // namespace sha1
