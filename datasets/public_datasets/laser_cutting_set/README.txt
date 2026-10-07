Basic sheet-metal DXF examples for cut / fold / etch operation parsing

Contents: 8 DXFs with simple flat plates and L/U brackets. They are collected from public sample/demo sources. They are useful as parsing and layer-segmentation examples, not as an RFQ dataset and not production-approved.

Sources and interpretation
- Medalist Manufacturing: one actual shop-published sample. The company documents cut geometry, separate etch layer names, and etched up-bend lines. See its DXF guide for the intended convention.
- Flat2DXF: a demo bracket with separate cut/bend layers. Its own page says it is a demo, not real customer CAD or for direct production.
- Sheet_Metal_AI_Assistant: four bracket and two flat-plate examples with CUT / BEND / HOLE / TEXT layers. Its README says the project is an engineer-review MVP, not final production files. Treat TEXT as annotation, not automatically as etch.

Layer-to-operation guidance
- CUT: outer profiles, slots and internal cutouts. The HOLE layer in the assistant examples contains hole geometry; count it as cut geometry for process decomposition while preserving the original layer label.
- BEND: fold/bend location markers. They do not always encode bend angle, direction, tooling or bend sequence.
- ETCH: explicit etch layer in the Medalist example/convention. The other examples do not all contain an etch layer. Do not treat TEXT as etch without confirming content.

Licensing
This is a private working collection, not a blanket relicensing. Medalist and Flat2DXF sample pages do not state reuse licenses. The GitHub API reports no declared license for Sheet_Metal_AI_Assistant. Review each source and obtain permission before redistribution or commercial model training.

See manifest.csv for direct source URLs, byte sizes, hashes, observed layers, and per-file notes.
