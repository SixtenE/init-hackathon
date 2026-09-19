#pragma once
// Tiny JSON value + parser + serializer.
// Supports: null, bool, number (double), string, array, object.
// Sufficient for flat/nested game protocol messages.
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace json {

class Value;
using Object = std::map<std::string, Value>;
using Array = std::vector<Value>;

class Value {
 public:
  enum Type { Null, Bool, Number, String, ArrayT, ObjectT };

  Type type = Null;
  bool b = false;
  double num = 0.0;
  std::string str;
  std::shared_ptr<Array> arr;
  std::shared_ptr<Object> obj;

  Value() = default;

  static Value mkNull() { Value v; v.type = Null; return v; }
  static Value mkBool(bool x) { Value v; v.type = Bool; v.b = x; return v; }
  static Value mkNum(double x) { Value v; v.type = Number; v.num = x; return v; }
  static Value mkStr(const std::string& x) { Value v; v.type = String; v.str = x; return v; }
  static Value mkArr() { Value v; v.type = ArrayT; v.arr = std::make_shared<Array>(); return v; }
  static Value mkObj() { Value v; v.type = ObjectT; v.obj = std::make_shared<Object>(); return v; }

  bool isObj() const { return type == ObjectT; }
  bool isArr() const { return type == ArrayT; }
  bool isNum() const { return type == Number; }
  bool isStr() const { return type == String; }
  bool isBool() const { return type == Bool; }

  Value& operator[](const std::string& k) {
    if (type != ObjectT) *this = mkObj();
    return (*obj)[k];
  }

  const Value* find(const std::string& k) const {
    if (type != ObjectT || !obj) return nullptr;
    auto it = obj->find(k);
    if (it == obj->end()) return nullptr;
    return &it->second;
  }

  double asNum(double fallback = 0.0) const {
    return isNum() ? num : fallback;
  }
  bool asBool(bool fallback = false) const {
    return isBool() ? b : fallback;
  }
  const std::string& asStr(const std::string& fallback = "") const {
    static const std::string empty;
    return isStr() ? str : (fallback.empty() ? empty : fallback);
  }

  // Serialize directly into a single string buffer, with no per-node
  // std::ostringstream allocation. This is the hot path used by the
  // snapshot loop; serialize() is just a thin wrapper around it.
  void writeTo(std::string& out) const;

  std::string serialize() const;
};

namespace detail {

inline void escapeString(std::string& out, const std::string& s) {
  out.push_back('"');
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if (static_cast<uint8_t>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04X", (int)(uint8_t)c);
          out += buf;
        } else {
          out.push_back(c);
        }
    }
  }
  out.push_back('"');
}

// Format a number the same way the old ostringstream path did: integers
// (when finite, integral, and within safe bounds) as %lld, otherwise as
// %g (6 significant digits, matching the iostream default).
inline void writeNumber(std::string& out, double num) {
  char buf[32];
  int n;
  if (std::isfinite(num) && num == std::floor(num) && std::fabs(num) < 1e15) {
    n = std::snprintf(buf, sizeof(buf), "%lld", (long long)num);
  } else {
    n = std::snprintf(buf, sizeof(buf), "%g", num);
  }
  if (n > 0) out.append(buf, (size_t)n);
}

}  // namespace detail

// Recursively write this value into a single string buffer. Unlike the
// old serialize() (which built a new std::ostringstream per node and
// concatenated temporary strings), this does zero per-node stream
// allocations.
inline void Value::writeTo(std::string& out) const {
  switch (type) {
    case Null: out += "null"; break;
    case Bool: out += (b ? "true" : "false"); break;
    case Number: detail::writeNumber(out, num); break;
    case String: detail::escapeString(out, str); break;
    case ArrayT: {
      out.push_back('[');
      for (size_t i = 0; i < arr->size(); i++) {
        if (i) out.push_back(',');
        (*arr)[i].writeTo(out);
      }
      out.push_back(']');
      break;
    }
    case ObjectT: {
      out.push_back('{');
      bool first = true;
      for (const auto& kv : *obj) {
        if (!first) out.push_back(',');
        first = false;
        detail::escapeString(out, kv.first);
        out.push_back(':');
        kv.second.writeTo(out);
      }
      out.push_back('}');
      break;
    }
  }
}

inline std::string Value::serialize() const {
  std::string out;
  out.reserve(128);
  writeTo(out);
  return out;
}

class Parser {
 public:
  explicit Parser(const std::string& src) : s_(src) {}

  Value parse() {
    skipWs();
    Value v = parseValue();
    skipWs();
    return v;
  }

 private:
  const std::string& s_;
  size_t i_ = 0;

  void skipWs() {
    while (i_ < s_.size()) {
      char c = s_[i_];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        i_++;
      } else {
        break;
      }
    }
  }

  char peek() {
    if (i_ >= s_.size()) throw std::runtime_error("JSON: unexpected end");
    return s_[i_];
  }

  char next() {
    if (i_ >= s_.size()) throw std::runtime_error("JSON: unexpected end");
    return s_[i_++];
  }

  void expect(char c) {
    char g = next();
    if (g != c) throw std::runtime_error("JSON: expected");
  }

  Value parseValue() {
    skipWs();
    char c = peek();
    if (c == '{') return parseObject();
    if (c == '[') return parseArray();
    if (c == '"') return parseString();
    if (c == 't' || c == 'f') return parseBool();
    if (c == 'n') return parseNull();
    return parseNumber();
  }

  Value parseObject() {
    expect('{');
    Value v = Value::mkObj();
    skipWs();
    if (peek() == '}') { next(); return v; }
    while (true) {
      skipWs();
      std::string key = parseString().str;
      skipWs();
      expect(':');
      Value val = parseValue();
      (*v.obj)[key] = val;
      skipWs();
      char c = next();
      if (c == ',') continue;
      if (c == '}') break;
      throw std::runtime_error("JSON: bad object");
    }
    return v;
  }

  Value parseArray() {
    expect('[');
    Value v = Value::mkArr();
    skipWs();
    if (peek() == ']') { next(); return v; }
    while (true) {
      Value val = parseValue();
      v.arr->push_back(val);
      skipWs();
      char c = next();
      if (c == ',') continue;
      if (c == ']') break;
      throw std::runtime_error("JSON: bad array");
    }
    return v;
  }

  Value parseString() {
    expect('"');
    std::string out;
    while (true) {
      char c = next();
      if (c == '"') break;
      if (c == '\\') {
        char e = next();
        switch (e) {
          case '"': out.push_back('"'); break;
          case '\\': out.push_back('\\'); break;
          case '/': out.push_back('/'); break;
          case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break;
          case 't': out.push_back('\t'); break;
          case 'b': out.push_back('\b'); break;
          case 'f': out.push_back('\f'); break;
          case 'u': {
            int cp = 0;
            for (int k = 0; k < 4; k++) {
              char h = next();
              cp <<= 4;
              if (h >= '0' && h <= '9') cp |= h - '0';
              else if (h >= 'a' && h <= 'f') cp |= h - 'a' + 10;
              else if (h >= 'A' && h <= 'F') cp |= h - 'A' + 10;
              else throw std::runtime_error("JSON: bad \\u");
            }
            if (cp < 0x80) {
              out.push_back((char)cp);
            } else if (cp < 0x800) {
              out.push_back((char)(0xC0 | (cp >> 6)));
              out.push_back((char)(0x80 | (cp & 0x3F)));
            } else {
              out.push_back((char)(0xE0 | (cp >> 12)));
              out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
              out.push_back((char)(0x80 | (cp & 0x3F)));
            }
            break;
          }
          default: out.push_back(e); break;
        }
      } else {
        out.push_back(c);
      }
    }
    return Value::mkStr(out);
  }

  Value parseBool() {
    if (s_.compare(i_, 4, "true") == 0) { i_ += 4; return Value::mkBool(true); }
    if (s_.compare(i_, 5, "false") == 0) { i_ += 5; return Value::mkBool(false); }
    throw std::runtime_error("JSON: bad bool");
  }

  Value parseNull() {
    if (s_.compare(i_, 4, "null") == 0) { i_ += 4; return Value::mkNull(); }
    throw std::runtime_error("JSON: bad null");
  }

  Value parseNumber() {
    size_t start = i_;
    if (peek() == '-') i_++;
    while (i_ < s_.size() && ((s_[i_] >= '0' && s_[i_] <= '9'))) i_++;
    if (i_ < s_.size() && s_[i_] == '.') {
      i_++;
      while (i_ < s_.size() && (s_[i_] >= '0' && s_[i_] <= '9')) i_++;
    }
    if (i_ < s_.size() && (s_[i_] == 'e' || s_[i_] == 'E')) {
      i_++;
      if (i_ < s_.size() && (s_[i_] == '+' || s_[i_] == '-')) i_++;
      while (i_ < s_.size() && (s_[i_] >= '0' && s_[i_] <= '9')) i_++;
    }
    std::string numStr = s_.substr(start, i_ - start);
    try {
      return Value::mkNum(std::stod(numStr));
    } catch (...) {
      throw std::runtime_error("JSON: bad number");
    }
  }
};

inline Value parse(const std::string& s) {
  Parser p(s);
  return p.parse();
}

}  // namespace json
