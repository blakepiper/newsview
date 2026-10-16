export const SCIENTIST_SOURCES: readonly string[];
export const FINANCE_PATTERNS: Record<string, RegExp>;
export const FINANCE_SOURCE_TOPICS: Record<string, string>;
export type SourceKind = 'author' | 'official' | 'vendor' | 'journal' | 'summary' | 'discovery' | 'discussion' | 'reporting';
export interface PolicyItem { title: string; source: string; description?: string; link?: string }
export function financeTopics(item: PolicyItem): string[];
export function isFinanceEntry(item: PolicyItem): boolean;
export function sourceWindowDays(source: string): number;
export function sourceKind(source: string): SourceKind;
export function publisherIdentity(source: string): string;
export function canonicalArticleLink(value: string): string;
export function isPromotionalEntry(item: PolicyItem): boolean;
export function entryContentType(item: PolicyItem): string;
