# tree-sitter-vscode

Bring the power of Tree-sitter to VSCode!

## Description

This extension adds syntactic and semantic highlighting
with [Tree-sitter](https://tree-sitter.github.io/) to Visual Studio Code.

By default, VSCode uses TextMate grammars for fast syntax highlighting
and Language Servers for the more sophisticated semantic highlighting.
TextMate grammars, however, are RegEx based
and can therefore not fully represent most programming languages.
A fully-fledged language server, on the other hand, is a lot of work, 
and therefore might be too much effort for toy projects or DSLs.
The middle-ground is, were Tree-sitter shines.
It supports more powerful grammars, while still being easy to write.
And it comes with the benefit, that injecting other languages is a breeze!

What this extension does, is register a "semantic token provider" with VSCode,
that executes a user-supplied Tree-sitter parser on the given file.
The parsed tree is then queried for tokens which should be highlighted.
The collected tokens are then given to VSCode with their highlighting information.

Have a look at the [Tree-sitter homepage](https://tree-sitter.github.io/)
to learn how to write a Tree-sitter grammar
or skim through the list of the many available parsers ready to use.

## Configuration

This extension does not come with any built-in parsers.
To use your own parser, you need to specify its location
and the location of the query files on the file system in the `settings.json`.
For each language that you want to parse,
a dictionary with the following keys needs to be added.

| Key                       | Description                                                                                                                   |
| -------------             | ----------------------------------------------------------------------------------------------------------------------------- |
| lang                      | The language identifier                                                                                                       |
| parser                    | The path to your parser's WASM file                                                                                           |
| highlights                | The path to the file with your highlighting queries.                                                                          |
| injections                | The path to the file with your injection queries. (optional)                                                                  |
| injectionOnly             | Whether this language should only be highlighted in injections, and not in files of that file type. (optional, default=false) |
| semanticTokenTypeMappings | Object of rules specifying how Tree-sitter semantic token types are mapped to VS Code semantic token types                    |

Note, that this extension uses the WASM bindings for the Tree-sitter parsers.
Have a look 
[here](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md#generate-wasm-language-files)
to see how you can generate those.

```json
"tree-sitter-vscode.languageConfigs": [
    {
        "lang": "xyz",
        "parser": "/path/to/your/tree-sitter-xyz.wasm",
        "highlights": "/path/to/your/highlights.scm",
        "injections": "/path/to/your/injections.scm",
        "semanticTokenTypeMappings": {
            "constant": {
                "targetTokenModifiers": ["declaration", "readonly"],
                "targetTokenType": "variable"
            },
            "module": {
                "targetTokenType": "namespace"
            },
            "variable.member": {
                "targetTokenType": "property"
            },
            "variable.parameter": {
                "targetTokenType": "parameter"
            }
      }
    }
]
```

### Changing the activation event

I am no clairvoyant (unfortunately)
and therefore don't know which languages you want to use this extension with.
This is why, by default, this extension will be activated on any language
(though parsing will only be performed on configured languages).
If you want to change that behavior, you need to modify this extension's `package.json`
in the extensions folder of VSCode (Command _Extensions: Open Extension Folder_).
(There is no dynamic way, as far as I know.)
Just go ahead and change the `"activationEvents"` array to what you would prefer.
For example, the following would trigger the extension only,
if a file of the language `xyz` is open.

```json
"activationEvents": [
    "onLanguage:xyz"
]
```

## Commands

### Reload

The command _tree-sitter-vscode: Reload_ will basically restart the extension,
which has the following effects:

- Changes in the config are taken into account.
- The parser is loaded from file again.
- The query files are loaded again.
- The semantic token provider will be re-registered (which overrules other providers for the same language).

## Injecting other languages

To inject other languages into a given language,
an injection query in the `injections` file (see the [config](#configuration)) has to be added.

There are multiple ways to set the highlighting language for a given query.
The simplest way is to name the capture with the language's name.
This is not the standard Tree-sitter way, but e.g. also supported by Neovim.

```scheme
(my-query) @python
```

Alternatively, the `#set!` directive can be used
(see [here](https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html#language-injection)
and [here](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html#the-set-directive)),
which has the same effect.

```scheme
((my-query) @injection.content
    (#set! injection.language "python"))
```

There is also the option, to determine the language dynamically using `@injection.language` and `@injection.content`.

```scheme
(my-query
    (language-sub-query) @injection.language
    (content-sub-query) @injection.content)
```

Other options, provided by Tree-sitter are not supported yet.

## Known Issues

### Multiple semantic token providers

VSCode is not able to handle multiple semantic token providers,
so only one is being used at a given time to highlight a file.
It seems, like the last one to be registered wins (see [here](https://github.com/microsoft/vscode/issues/145530)).
Since, this extension's startup time is relatively fast,
it will usually be overruled by other providers.
However, you can use the [Reload Command](#reload) to re-register the semantic token provider,
and therefore use it again, over others.

### Adding custom languages to VSCode

Unfortunately, I haven't been able to figure out a way
to add custom languages to VSCode natively.
As far as I know, this is only possible through plugins,
which need to specify the language details.

If you don't want to write your own plugin, however,
you can use the following hack.
Just go to the extensions folder of VSCode (Command _Extensions: Open Extension Folder_)
and modify an existing extensions' `package.json` file (e. g. this extension's).
In the `"contributes"` section, add the `"languages"` key with your language details.

```json
"languages": [
    {
        "id": "xyz",
        "extensions": [
            ".xyz"
        ]
    }
]
```
