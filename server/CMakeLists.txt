cmake_minimum_required(VERSION 3.16)

# Prefer g++ so the linker finds GCC's libstdc++. clang++ as /usr/bin/c++
# often fails on this image with "cannot find -lstdc++".
if(NOT CMAKE_CXX_COMPILER)
  find_program(GAME_SERVER_GXX g++)
  if(GAME_SERVER_GXX)
    set(CMAKE_CXX_COMPILER "${GAME_SERVER_GXX}")
  endif()
endif()

project(game_server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(game_server
  src/main.cpp
  src/game.cpp
  src/websocket.cpp
)

target_include_directories(game_server PRIVATE src)

if(MSVC)
  target_compile_options(game_server PRIVATE /W4)
else()
  target_compile_options(game_server PRIVATE -Wall -Wextra -Wpedantic)
endif()
