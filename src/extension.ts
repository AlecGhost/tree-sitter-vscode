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

type Config = { lang: string, parser: string, highlights: string, injections?: string };
type Language = { parser: Parser, highlightQuery: Parser.Query, injectionQuery?: Parser.Query }
type Token = { range: vscode.Range, type: string, modifiers: string[] }

async function initLanguage(config: Config): Promise<Language> {
	await Parser.init().catch();
	const parser = new Parser;
	const lang = await Parser.Language.load(config.parser);
	parser.setLanguage(lang);
	const queryText = fs.readFileSync(config.highlights, "utf-8");
	const highlightQuery = lang.query(queryText);
	let injectionQuery = undefined;
	if (config.injections !== undefined) {
		const injectionText = fs.readFileSync(config.injections, "utf-8");
		injectionQuery = lang.query(injectionText);
	}
	return { parser, highlightQuery, injectionQuery };
}

function convertPosition(pos: Parser.Point): vscode.Position {
	return new vscode.Position(pos.row, pos.column);
}

function addPosition(range: vscode.Range, pos: vscode.Position): vscode.Range {
	const start = (range.start.line == 0)
		? new vscode.Position(range.start.line + pos.line, range.start.character + pos.character)
		: new vscode.Position(range.start.line + pos.line, range.start.character);
	const end = (range.end.line == 0)
		? new vscode.Position(range.end.line + pos.line, range.end.character + pos.character)
		: new vscode.Position(range.end.line + pos.line, range.end.character);
	return new vscode.Range(start, end);
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

	matchesToTokens(matches: Parser.QueryMatch[]): Token[] {
		return matches
			.flatMap(match => match.captures)
			.flatMap(capture => {
				let { type, modifiers: modifiers } = parseCaptureName(capture.name);
				let start = convertPosition(capture.node.startPosition);
				let end = convertPosition(capture.node.endPosition);
				if (TOKEN_TYPES.includes(type)) {
					const validModifiers = modifiers.filter(modifier => TOKEN_MODIFIERS.includes(modifier));
					const token: Token = { range: new vscode.Range(start, end), type, modifiers: validModifiers };
					return [token];
				} else {
					return [];
				}
			});
	}

	async getInjections(text: string, injectionQuery: Parser.Query, node: Parser.SyntaxNode): Promise<Token[]> {
		const matches = injectionQuery.matches(node);
		const tokens = matches
			.flatMap(match => match.captures)
			.flatMap(async capture => {
				// injection based on capture name
				// TODO: add support for official injection queries
				const lang = capture.name;
				const config = this.configs.find(config => config.lang === lang);
				if (config !== undefined) {
					if (!(lang in this.tsLangs)) {
						this.tsLangs[lang] = await initLanguage(config);
					}
					const { parser, highlightQuery, injectionQuery } = this.tsLangs[lang];
					const captureText = text.substring(capture.node.startIndex, capture.node.endIndex);
					const tree = parser.parse(captureText);
					const matches = highlightQuery.matches(tree.rootNode);
					let tokens = this.matchesToTokens(matches);
					if (injectionQuery !== undefined) {
						const injectionTokens = await this.getInjections(captureText, injectionQuery, tree.rootNode);
						tokens = tokens.concat(injectionTokens);
					}
					tokens = tokens
						.map(token => {
							return {
								range: addPosition(token.range, convertPosition(capture.node.startPosition)),
								type: token.type,
								modifiers: token.modifiers
							}
						});
					return tokens;
				}
				return [];
			});
		return (await Promise.all(tokens)).flat();
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
		const { parser, highlightQuery, injectionQuery } = this.tsLangs[lang];
		const text = document.getText();
		const tree = parser.parse(text);
		const matches = highlightQuery.matches(tree.rootNode);
		let tokens = this.matchesToTokens(matches);
		if (injectionQuery !== undefined) {
			const injectionTokens = await this.getInjections(text, injectionQuery, tree.rootNode);
			tokens = tokens.concat(injectionTokens);
		}
		const builder = new vscode.SemanticTokensBuilder(LEGEND);
		tokens.forEach(token => builder.push(token.range, token.type, token.modifiers));
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
		const injections = config["injections"];
		if (typeof lang !== "string") {
			throw new TypeError("Expected `lang` to be a string.");
		}
		if (typeof parser !== "string") {
			throw new TypeError("Expected `parser` to be a string.");
		}
		if (typeof highlights !== "string") {
			throw new TypeError("Expected `highlights` to be a string.");
		}
		if (injections !== undefined && typeof injections !== "string") {
			throw new TypeError("Expected `injections` to be a string.");
		}
		return { lang, parser, highlights, injections };
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
