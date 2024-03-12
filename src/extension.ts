import * as fs from 'fs';
import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';

// VSCode default token types and modifiers from:
// https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
const TOKEN_TYPES = [
	'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type', 'parameter', 'variable', 'property',
	'enumMember', 'decorator', 'event', 'function', 'method', 'macro', 'label', 'comment', 'string', 'keyword',
	'number', 'regexp', 'operator',
];
const TOKEN_MODIFIERS = [
	'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification',
	'documentation', 'defaultLibrary',
];
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

type Config = { lang: string, parser: string, highlights: string };
type Language = { parser: Parser, highlightQuery: Parser.Query }

async function initLanguage(config: Config): Promise<Language> {
	await Parser.init().catch();
	const parser = new Parser;
	const lang = await Parser.Language.load(config.parser);
	parser.setLanguage(lang);
	const queryText = fs.readFileSync(config.highlights, "utf-8");
	const highlightQuery = lang.query(queryText);
	return { parser: parser, highlightQuery: highlightQuery };
}

function convertPosition(pos: Parser.Point): vscode.Position {
	return new vscode.Position(pos.row, pos.column);
}

function parseCaptureName(name: string): { type: string, modifiers: string[] } {
	const parts = name.split(".")
	if (parts.length === 0) {
		throw new Error("Capture name is empty.");
	} else if (parts.length === 1) {
		return { type: parts[0], modifiers: [] };
	} else {
		return { type: parts[0], modifiers: parts.slice(1) };
	}
}

class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private readonly configs: Config[];
	private tsLangs: { [lang: string]: Language } = {};

	constructor(configs: Config[]) {
		this.configs = configs;
	}

	async provideDocumentSemanticTokens(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	) {
		const lang = document.languageId;
		if (!(lang in this.tsLangs)) {
			const config = this.configs.find(config => config.lang === lang);
			if (config === undefined) {
				throw new Error("No config for lang provided.");
			}
			this.tsLangs[lang] = await initLanguage(config);
		}
		const { parser, highlightQuery } = this.tsLangs[lang];
		const tree = parser.parse(document.getText());
		const matches = highlightQuery.matches(tree.rootNode);
		const builder = new vscode.SemanticTokensBuilder(LEGEND);
		matches.forEach((match) => {
			match.captures.forEach((capture) => {
				let { type, modifiers: modifiers } = parseCaptureName(capture.name);
				let start = convertPosition(capture.node.startPosition);
				let end = convertPosition(capture.node.endPosition);
				if (TOKEN_TYPES.includes(type)) {
					const validModifiers = modifiers.filter(modifier => TOKEN_MODIFIERS.includes(modifier));
					builder.push(new vscode.Range(start, end), type, validModifiers);
				}
			});
		});
		return builder.build();
	}
}

function parseConfigs(configs: any): Config[] {
	if (!Array.isArray(configs)) {
		throw new TypeError("Expected a list.");
	}
	return configs.map(config => {
		const lang = config["lang"];
		const parser = config["parser"];
		const highlights = config["highlights"];
		if (typeof lang !== "string") {
			throw new TypeError("Expected `lang` to be a string.");
		}
		if (typeof parser !== "string") {
			throw new TypeError("Expected `parser` to be a string.");
		}
		if (typeof highlights !== "string") {
			throw new TypeError("Expected `highlights` to be a string.");
		}
		return { lang: lang, parser: parser, highlights: highlights };
	});
}

export function activate(context: vscode.ExtensionContext) {
	const rawConfigs = vscode.workspace.getConfiguration("tree-sitter-vscode").get("languageConfigs");
	const configs = parseConfigs(rawConfigs);
	const languageMap = configs.map(config => { return { language: config.lang }; });
	const provider = vscode.languages.registerDocumentSemanticTokensProvider(
		languageMap,
		new SemanticTokensProvider(configs),
		LEGEND,
	)
	context.subscriptions.push(provider);
}

export function deactivate() { }
