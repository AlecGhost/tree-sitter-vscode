# Change Log

## 0.2.0

Supported Tree-sitter ABI version: 14

### Features

- Add support to configure how Tree-sitter semantic token types
  are mapped to VS Code semantic token types ([Sherif Fanous](https://github.com/sherif-fanous))
- Add output channel to log debug messages if the "tree-sitter-vscode.debug" configuration setting
  is set to `true` ([Sherif Fanous](https://github.com/sherif-fanous))
- Add support for relative paths

## 0.1.0

Supported Tree-sitter ABI version: 14

### Features

- Add support for dynamic language injection with `@injection.content` and `@injection.language` captures
- Add support for the `#set!` directive
- Add _Reload_ command
- Add `injectionOnly` configuration
- Add supported Tree-sitter ABI version to changelog (reported by [miczim00](https://github.com/miczim00))

### Bug Fixes

- Fix handling of contained tokens (by [Tritlo](https://github.com/Tritlo))
- Fix handling of contained injected tokens (reported by [Rowan-Mather](https://github.com/Rowan-Mather))

## 0.0.1

Supported Tree-sitter ABI version: 14

- Initial release
