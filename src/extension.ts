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

/**
 * Semantic tokens cannot span multiple lines,
 * so if the range doesn't end in the same line,
 * one token for each line is created.
 */
function splitToken(token: Token): Token[] {
	const start = token.range.start;
	const end = token.range.end;
	if (start.line != end.line) {
		// 100_0000 is chosen as the arbitrary length, since the actual line length is unknown.
		// Choosing a big number works, while `Number.MAX_VALUE` seems to confuse VSCode.
		const max_line_length = 100_000;
		const lineDiff = end.line - start.line;
		if (lineDiff < 0) {
			throw new RangeError("Invalid token range");
		}
		let tokens: Token[] = [];
		// token for the first line, beginning at the start char
		tokens.push({
			range: new vscode.Range(start, new vscode.Position(start.line, max_line_length)),
			type: token.type,
			modifiers: token.modifiers
		});
		// tokens for intermediate lines, spanning from 0 to max_line_length
		for (let i = 1; i < lineDiff; i++) {
			const middleToken: Token = {
				range: new vscode.Range(
					new vscode.Position(start.line + i, 0),
					new vscode.Position(start.line + i, max_line_length)),
				type: token.type,
				modifiers: token.modifiers,
			};
			tokens.push(middleToken);
		}
		// token for the last line, ending at the end char
		tokens.push({
			range: new vscode.Range(new vscode.Position(end.line, 0), end),
			type: token.type,
			modifiers: token.modifiers
		});
		return tokens;
	} else {
		return [token];
	}
}

class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private readonly configs: Config[];
	private tsLangs: { [lang: string]: Language } = {};

	constructor(configs: Config[]) {
		this.configs = configs;
	}

	matchesToTokens(matches: Parser.QueryMatch[]): Token[] {
		const unsplit_tokens: Token[] = matches
			.flatMap(match => match.captures)
			.flatMap(capture => {
				let { type, modifiers: modifiers } = parseCaptureName(capture.name);
				let start = convertPosition(capture.node.startPosition);
				let end = convertPosition(capture.node.endPosition);
				if (TOKEN_TYPES.includes(type)) {
					const validModifiers = modifiers.filter(modifier => TOKEN_MODIFIERS.includes(modifier));
					const token: Token = {
						range: new vscode.Range(start, end),
						type: type,
						modifiers: validModifiers
					};
					return token;
				} else {
					return [];
				}
			});

		return unsplit_tokens.flatMap(token => {
			// Get all tokens contained within this token
			const contained = unsplit_tokens.filter(o_t =>
				(!(token.range.isEqual(o_t.range))) && token.range.contains(o_t.range)
			);

			if (contained.length > 0) {
				// Sort contained tokens by their start position
				const sorted_contained = contained.sort((a, b) =>
					a.range.start.compareTo(b.range.start)
				);

				let result_tokens = [];
				let current_pos = token.range.start;

				// Create tokens for the gaps between contained tokens
				for (const contained_token of sorted_contained) {
					// If there's a gap before this contained token, create a token for it
					if (current_pos.compareTo(contained_token.range.start) < 0) {
						result_tokens.push({
							range: new vscode.Range(current_pos, contained_token.range.start),
							type: token.type,
							modifiers: token.modifiers
						});
					}
					current_pos = contained_token.range.end;
				}

				// Add token for the gap after the last contained token if needed
				if (current_pos.compareTo(token.range.end) < 0) {
					result_tokens.push({
						range: new vscode.Range(current_pos, token.range.end),
						type: token.type,
						modifiers: token.modifiers
					});
				}

				return result_tokens;
			} else {
				return token;
			}
		}).flatMap(splitToken);
	}

	/**
	 * Determine the language to be injected into the given match.
	 */
	async getInjectionLang(match: Parser.QueryMatch): Promise<Language | null> {
		const {
			"injection.language": injectionLanguage,
			// TODO: add support for self and parent injections
			// "injection.self": injectionSelf,
			// "injection.parent": injectionParent
		} = (match as any).setProperties || {};
		const lang =
			// a hard coded language overrides all other methods
			(typeof injectionLanguage == "string" ? injectionLanguage : undefined)
			// dynamically determined language
			|| match.captures.find(capture => capture.name === "injection.language")?.node.text
			// custom language determination by capture name
			|| match.captures.find(capture => this.configs.map(config => config.lang).includes(capture.name))?.name;
		if (lang !== undefined) {
			const config = this.configs.find(config => config.lang === lang);
			if (config !== undefined) {
				if (!(lang in this.tsLangs)) {
					this.tsLangs[lang] = await initLanguage(config);
				}
				return this.tsLangs[lang];
			}
		}
		return null;
	}

	/**
	 * Get the tokens for a single capture with the given language parser.
	 * Calls `getInjections` for nested injections.
	 */
	async captureToTokens(capture: Parser.QueryCapture, lang: Language): Promise<Token[]> {
		const { parser, highlightQuery, injectionQuery } = lang;
		const captureText = capture.node.text;
		const tree = parser.parse(captureText);
		const matches = highlightQuery.matches(tree.rootNode);
		let tokens = this.matchesToTokens(matches);
		if (injectionQuery !== undefined) {
			const injectionTokens = await this.getInjections(injectionQuery, tree.rootNode);
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

	/**
	 * Matches the given injection query against the given node and returns the highlighting tokens.
	 * This also works for nested injections.
	 */
	async getInjections(injectionQuery: Parser.Query, node: Parser.SyntaxNode): Promise<Token[]> {
		const matches = injectionQuery.matches(node);
		const tokens = matches
			.map(async match => {
				const lang = await this.getInjectionLang(match);
				if (lang === null) {
					return [];
				}
				const captureTokens = match.captures.map(async capture => await this.captureToTokens(capture, lang));
				return (await Promise.all(captureTokens)).flat();
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
			const injectionTokens = await this.getInjections(injectionQuery, tree.rootNode);
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
