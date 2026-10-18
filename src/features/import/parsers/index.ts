import type { CustomSource } from '@/data/types';
import type { ImportFile, Parser } from '../types';
import { genericBankParser, iobParser } from './bank';
import { googlePayParser } from './googlePay';
import { customParser, legacySheetParser, pasteParser, paytmParser, phonePeParser } from './others';

/** Add a bank by adding a parser here; nothing else in the app changes. */
export const BUILT_IN: Parser[] = [googlePayParser, phonePeParser, paytmParser, legacySheetParser, iobParser, genericBankParser, pasteParser];

export function allParsers(custom: CustomSource[]): Parser[] {
  return [...custom.map(customParser), ...BUILT_IN];
}

export function rankParsers(file: ImportFile, custom: CustomSource[]): { parser: Parser; confidence: number }[] {
  return allParsers(custom)
    .map((parser) => {
      let confidence = 0;
      try {
        confidence = parser.detect(file);
      } catch {
        confidence = 0;
      }
      return { parser, confidence };
    })
    .filter((x) => x.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}
