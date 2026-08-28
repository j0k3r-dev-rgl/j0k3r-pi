import { Type } from 'typebox';
import type { PiToolResult, RegisterWebsearchToolsDeps } from '../../types.js';
import { ValidationError } from '../../validation.js';
import { buildFailure, toToolError } from '../common/index.js';
import { executeInternalTool, internalToolsFromDeps } from '../common/internal.js';
import { registerTool, type WebsearchToolModule } from '../common/index.js';
import { arxivResearchTools } from './arxiv.js';
import { crossrefResearchTools } from './crossref.js';
import { europePmcResearchTools } from './europe-pmc.js';
import { openAlexResearchTools } from './openalex.js';
import { semanticScholarResearchTools } from './semantic-scholar.js';

export const researchGroupedToolNames = ['research_get', 'research_graph_get'] as const;

const researchSources = ['openalex', 'arxiv', 'crossref', 'europe_pmc', 'semantic_scholar'] as const;
const graphSources = ['openalex', 'crossref', 'europe_pmc', 'semantic_scholar'] as const;
const graphKinds = ['citations', 'references'] as const;

const sourceSchema = (sources: readonly string[]) => Type.Union(
  sources.map((source) => Type.Literal(source)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]],
);

const researchGetParameters = Type.Object({
  source: sourceSchema(researchSources),
  ref: Type.Optional(Type.String({ description: 'Generic selected research item reference from research_search followup_ref.' })),
  work: Type.Optional(Type.String({ description: 'OpenAlex work id, URL, DOI, or DOI URL.' })),
  paper: Type.Optional(Type.String({ description: 'arXiv or Semantic Scholar paper id, URL, DOI, or external id.' })),
  doi: Type.Optional(Type.String({ description: 'Crossref DOI or DOI URL.' })),
  article: Type.Optional(Type.String({ description: 'Europe PMC DOI, PMID/external id, PMCID, or URL.' })),
});

const graphCommonProperties = {
  ref: Type.Optional(Type.String({ description: 'Generic selected research item reference.' })),
  work: Type.Optional(Type.String({ description: 'OpenAlex work id, URL, DOI, or DOI URL.' })),
  paper: Type.Optional(Type.String({ description: 'Semantic Scholar paper id, URL, DOI, arXiv id, or external id.' })),
  doi: Type.Optional(Type.String({ description: 'Crossref DOI or DOI URL.' })),
  article: Type.Optional(Type.String({ description: 'Europe PMC DOI, PMID/external id, PMCID, or URL.' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum graph items to return.' })),
  page: Type.Optional(Type.Number({ description: 'One-based page number for providers that use page pagination.' })),
  offset: Type.Optional(Type.Number({ description: 'Zero-based offset for providers that use offset pagination.' })),
};

const researchGraphParameters = {
  ...Type.Object({
    source: sourceSchema(graphSources),
    graph: sourceSchema(graphKinds),
    ...graphCommonProperties,
  }),
  oneOf: [
    Type.Object({
      source: Type.Literal('openalex'),
      graph: sourceSchema(graphKinds),
      ref: graphCommonProperties.ref,
      work: graphCommonProperties.work,
      limit: graphCommonProperties.limit,
      page: graphCommonProperties.page,
    }),
    Type.Object({
      source: Type.Literal('crossref'),
      graph: Type.Literal('references'),
      ref: graphCommonProperties.ref,
      doi: graphCommonProperties.doi,
      limit: graphCommonProperties.limit,
      offset: graphCommonProperties.offset,
    }),
    Type.Object({
      source: Type.Literal('europe_pmc'),
      graph: sourceSchema(graphKinds),
      ref: graphCommonProperties.ref,
      article: graphCommonProperties.article,
      limit: graphCommonProperties.limit,
      page: graphCommonProperties.page,
    }),
    Type.Object({
      source: Type.Literal('semantic_scholar'),
      graph: sourceSchema(graphKinds),
      ref: graphCommonProperties.ref,
      paper: graphCommonProperties.paper,
      limit: graphCommonProperties.limit,
      offset: graphCommonProperties.offset,
    }),
  ],
};

type ResearchSource = typeof researchSources[number];
type GraphSource = typeof graphSources[number];
type GraphKind = typeof graphKinds[number];
type Input = Record<string, unknown>;

const legacyResearchModules = [openAlexResearchTools, arxivResearchTools, crossrefResearchTools, europePmcResearchTools, semanticScholarResearchTools] as const;

function asInput(value: unknown): Input {
  return value && typeof value === 'object' ? value as Input : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function optionalNumber(input: Input, key: string): number | undefined {
  return numberValue(input[key]);
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new ValidationError(`${field} is required.`);
  return result;
}

function requiredLiteral<T extends readonly string[]>(input: Input, key: string, values: T): T[number] {
  const value = stringValue(input[key]);
  if (!value || !(values as readonly string[]).includes(value)) {
    throw new ValidationError(`${key} must be one of: ${values.join(', ')}.`);
  }
  return value as T[number];
}

function refValue(input: Input, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(input[key]);
    if (value) return value;
  }
  return undefined;
}

function researchGetTarget(source: ResearchSource, input: Input): { tool: string; params: Input } {
  if (source === 'openalex') return { tool: 'openalex_work_get', params: { work: requiredString(refValue(input, 'work', 'ref'), 'work') } };
  if (source === 'arxiv') return { tool: 'arxiv_paper_get', params: { paper: requiredString(refValue(input, 'paper', 'ref'), 'paper') } };
  if (source === 'crossref') return { tool: 'crossref_work_get', params: { doi: requiredString(refValue(input, 'doi', 'ref'), 'doi') } };
  if (source === 'europe_pmc') return { tool: 'europe_pmc_article_get', params: { article: requiredString(refValue(input, 'article', 'ref'), 'article') } };
  return { tool: 'semantic_scholar_paper_get', params: { paper: requiredString(refValue(input, 'paper', 'ref'), 'paper') } };
}

const hiddenGraphToolNamePattern = /\b(?:openalex_work_citations_get|openalex_work_references_get|crossref_work_references_get|europe_pmc_article_citations_get|europe_pmc_article_references_get|semantic_scholar_paper_citations_get|semantic_scholar_paper_references_get)\b/g;

function retargetGraphContent(result: PiToolResult<unknown>): PiToolResult<unknown> {
  return {
    ...result,
    content: result.content.map((entry) => entry.type === 'text'
      ? { ...entry, text: entry.text.replace(hiddenGraphToolNamePattern, 'research_graph_get') }
      : entry),
  };
}

function researchGraphTarget(source: GraphSource, graph: GraphKind, input: Input): { tool: string; params: Input } {
  const limit = optionalNumber(input, 'limit');
  if (source === 'openalex') {
    return {
      tool: graph === 'citations' ? 'openalex_work_citations_get' : 'openalex_work_references_get',
      params: { work: requiredString(refValue(input, 'work', 'ref'), 'work'), limit, page: optionalNumber(input, 'page') },
    };
  }
  if (source === 'crossref') {
    if (graph === 'citations') throw new ValidationError('crossref supports references only; inbound citations are not exposed by Crossref REST.');
    return {
      tool: 'crossref_work_references_get',
      params: { doi: requiredString(refValue(input, 'doi', 'ref'), 'doi'), limit, offset: optionalNumber(input, 'offset') },
    };
  }
  if (source === 'europe_pmc') {
    return {
      tool: graph === 'citations' ? 'europe_pmc_article_citations_get' : 'europe_pmc_article_references_get',
      params: { article: requiredString(refValue(input, 'article', 'ref'), 'article'), limit, page: optionalNumber(input, 'page') },
    };
  }
  return {
    tool: graph === 'citations' ? 'semantic_scholar_paper_citations_get' : 'semantic_scholar_paper_references_get',
    params: { paper: requiredString(refValue(input, 'paper', 'ref'), 'paper'), limit, offset: optionalNumber(input, 'offset') },
  };
}

export const researchGroupedTools: WebsearchToolModule<typeof researchGroupedToolNames[number]> = {
  names: researchGroupedToolNames,
  register(pi: any, deps: RegisterWebsearchToolsDeps = {}) {
    const internalTools = internalToolsFromDeps(deps, legacyResearchModules);

    registerTool(pi, {
      name: 'research_get',
      label: 'Research Get',
      description: 'Fetch one selected paper/work/article from OpenAlex, arXiv, Crossref, Europe PMC, or Semantic Scholar.',
      promptSnippet: 'Fetch one selected research paper, work, or article by source-specific reference.',
      promptGuidelines: [
        'Use research_get after research_search when you need full details for one selected OpenAlex, arXiv, Crossref, Europe PMC, or Semantic Scholar item.',
        'Use research_get only with source-specific identifiers or refs from research_search results.',
      ],
      parameters: researchGetParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const source = requiredLiteral(input, 'source', researchSources);
          const target = researchGetTarget(source, input);
          return await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>;
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });

    registerTool(pi, {
      name: 'research_graph_get',
      label: 'Research Graph Get',
      description: 'Fetch citations or references for a selected research item when the source has verified graph/reference support.',
      promptSnippet: 'Fetch citations or references for a selected supported research item.',
      promptGuidelines: [
        'Use research_graph_get when the user needs citation or reference links for a known research item from a supported source.',
        'Use research_graph_get only after identifying the item and graph kind; use research_get first if item details are missing.',
      ],
      parameters: researchGraphParameters,
      async execute(id: string, params: unknown, _unused1?: unknown, _unused2?: unknown, context?: unknown): Promise<PiToolResult<unknown>> {
        try {
          const input = asInput(params);
          const source = requiredLiteral(input, 'source', graphSources);
          const graph = requiredLiteral(input, 'graph', graphKinds);
          const target = researchGraphTarget(source, graph, input);
          return retargetGraphContent(await executeInternalTool(internalTools, target.tool, id, target.params, context) as PiToolResult<unknown>);
        } catch (error) {
          return buildFailure(toToolError(error));
        }
      },
    });
  },
};
