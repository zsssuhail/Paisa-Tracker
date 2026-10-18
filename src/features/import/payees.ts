import { normalisePlace } from '@/features/rules/engine';

/**
 * Banks cut the payee to a fixed width (IOB: 14 characters) and add company suffixes:
 * "Flipkart Payme", "Zepto Marketpl", "Redbus India P", "Lenskart Solut". These helpers recover the
 * name a person would recognise, first from well-known brands, then from places already in the notebook.
 */

const BRANDS: [RegExp, string][] = [
  [/^flipkart/, 'Flipkart'],
  [/^(?:zepto|zeptonow|kiranakart)/, 'Zepto'],
  [/^zomato/, 'Zomato'],
  [/^(?:swiggy|bundl tech)/, 'Swiggy'],
  [/^instamart/, 'Swiggy Instamart'],
  [/^blinkit|^grofers/, 'Blinkit'],
  [/^lenskart/, 'Lenskart'],
  [/^redbus/, 'Redbus'],
  [/^(?:setc|state express t)/, 'SETC'],
  [/^tnstc/, 'TNSTC'],
  [/^metropolitan t/, 'MTC Chennai'],
  [/^cmrl/, 'CMRL Metro'],
  [/^irctc|^indian railway/, 'IRCTC'],
  [/^amazon pay gro|^amazon fresh/, 'Amazon Fresh'],
  [/^amazon/, 'Amazon'],
  [/^kfc/, 'KFC'],
  [/^mcdonald/, "McDonald's"],
  [/^domino/, "Domino's"],
  [/^spotify/, 'Spotify'],
  [/^netflix/, 'Netflix'],
  [/^(?:google play|google one|google pay)/, 'Google'],
  [/^bookmyshow|^bigtree/, 'BookMyShow'],
  [/^(?:bharti )?airtel/, 'Airtel'],
  [/^reliance jio|^jio/, 'Jio'],
  [/^myntra/, 'Myntra'],
  [/^meesho/, 'Meesho'],
  [/^ajio/, 'AJIO'],
  [/^nykaa/, 'Nykaa'],
  [/^bigbasket|^supermarket grocery/, 'BigBasket'],
  [/^dmart|^avenue supermarts/, 'DMart'],
  [/^apollo/, 'Apollo Pharmacy'],
  [/^medplus/, 'MedPlus'],
  [/^netmeds/, 'Netmeds'],
  [/^pharmeasy/, 'PharmEasy'],
  [/^(?:uber|uber india)/, 'Uber'],
  [/^ola\b|^ani technologies/, 'Ola'],
  [/^rapido|^roppen/, 'Rapido'],
  [/^ippb/, 'India Post Payments Bank'],
  [/^decathlon/, 'Decathlon'],
  [/^croma/, 'Croma'],
];

/** Company words (and the stubs left when they are cut off) that never help a person recognise a payee. */
const SUFFIXES = ['limited', 'private', 'pvt', 'ltd', 'india', 'technologies', 'technology', 'solutions', 'services', 'marketplace', 'payments', 'payment', 'retail', 'enterprises', 'commerce', 'internet', 'online', 'store'];

/** "Redbus India P" → "Redbus": drop trailing company words, or the cut-off start of one. */
function dropCutSuffixes(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1) {
    const last = out[out.length - 1].toLowerCase();
    const before = out[out.length - 2].toLowerCase();
    // A lone letter is an initial ("Shreenidhi R M") unless it follows a company word ("India P").
    const cutOff = last.length >= 3 || (last.length === 1 && SUFFIXES.includes(before));
    if (SUFFIXES.some((w) => w === last || (cutOff && w.startsWith(last)))) out.pop();
    else break;
  }
  return out;
}

export function brandOf(payee: string): string | undefined {
  const n = normalisePlace(payee);
  return BRANDS.find(([re]) => re.test(n))?.[1];
}

/**
 * The name to show: a known brand, else the full name of a place already in the notebook that this
 * (possibly cut-off) payee is the start of, else the payee without company suffixes.
 */
export function canonicalPayee(payee: string, knownPlaces: string[]): string {
  const p = payee.trim();
  if (!p) return p;
  const brand = brandOf(p);
  if (brand) return brand;
  const n = normalisePlace(p);
  if (n.length >= 6) {
    const known = knownPlaces
      .map((k) => ({ k, n: normalisePlace(k) }))
      .filter((x) => x.n !== n && (x.n.startsWith(n) || (n.length >= 10 && x.n.startsWith(n.slice(0, -1)))))
      .sort((a, b) => a.n.length - b.n.length)[0];
    if (known) return known.k;
  }
  return dropCutSuffixes(p.split(' ')).join(' ');
}
