import { TokenCategory, Prisma } from '@prisma/client';

export type HotToken = {
    id: string;
    name: string;
    contractAddress: string;
    note: string | null;
    marketCapNow: number | null;
    marketCapFirstEntry: number | null;
    category: TokenCategory;
    tags?: string[] | null;
    meta: Prisma.JsonValue | null;
    isCommunity: boolean;
    firstSeen: Date;
};

export type TokenUpdate = Partial<Omit<HotToken, 'id' | 'firstSeen' | 'contractAddress'>>;

export interface TokenListOptions {
    category?: TokenCategory;
    communityOnly?: boolean;
} 