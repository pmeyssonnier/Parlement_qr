import "server-only";
import raw from "../../data/corpus.json";
import { validateCorpus } from "./documents";
export const corpus = validateCorpus(raw);
