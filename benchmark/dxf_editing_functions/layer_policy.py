ANNOTATION_TYPES = {
    "TEXT", "MTEXT", "ATTRIB", "ATTDEF", "DIMENSION", "LEADER", "MLEADER",
    "MULTILEADER", "HATCH", "IMAGE", "WIPEOUT",
}


def is_etch_layer(name: str) -> bool:
    name = name.casefold()
    return "etch" in name or "engrav" in name
