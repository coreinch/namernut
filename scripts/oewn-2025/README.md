# Open English WordNet 2025

`index.noun`, `data.noun`, `index.adj`, `data.adj` from the
[Open English Wordnet](https://github.com/globalwordnet/english-wordnet)
2025 edition, in the classic Princeton WordNet database (WNDB) format.

Source: https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition
(`english-wordnet-2025-index.sense-fixed.zip`)

Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by
the Open English Wordnet team, building on WordNet 3.1 (Copyright 2011,
Princeton University). See the license text embedded in the header of each
data file.

Used by `scripts/build-dictionaries.mjs` to build `src/data/dictionaries.json`.
Not read by the app at runtime — only at build time, and only from this local
copy (no network access). Re-download from the release URL above to update.
