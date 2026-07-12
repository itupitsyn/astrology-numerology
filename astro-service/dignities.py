"""Traditional (classical) essential dignities for horary astrology.

Static reference tables — the deterministic backbone of a horary judgment.
Only the seven classical planets bear dignity; modern planets (Uranus,
Neptune, Pluto) and points are never rulers, so they are excluded here.

Sources: Claudius Ptolemy, *Tetrabiblos* (Egyptian bounds, faces); Dorotheus
of Sidon / William Lilly, *Christian Astrology* (rulerships, exaltations,
triplicities, dignity scoring). Where sources diverge (notably triplicities),
the choice is documented inline.

Signs are indexed 0..11 with Aries = 0, matching kerykeion's ``sign_num``.
All degree bounds are in degrees *within the sign* (0..30).
"""

from __future__ import annotations

from typing import Optional

# The seven classical planets, by kerykeion's capitalised name.
CLASSICAL_PLANETS = ("Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn")

# Sign abbreviation (kerykeion `sign`) -> index. Aries = 0.
SIGN_TO_NUM = {
    "Ari": 0, "Tau": 1, "Gem": 2, "Can": 3, "Leo": 4, "Vir": 5,
    "Lib": 6, "Sco": 7, "Sag": 8, "Cap": 9, "Aqu": 10, "Pis": 11,
}
NUM_TO_SIGN = {v: k for k, v in SIGN_TO_NUM.items()}

# Element by sign index: 0=Fire, 1=Earth, 2=Air, 3=Water.
FIRE, EARTH, AIR, WATER = "Fire", "Earth", "Air", "Water"
_ELEMENT_BY_SIGN = [
    FIRE, EARTH, AIR, WATER,  # Ari Tau Gem Can
    FIRE, EARTH, AIR, WATER,  # Leo Vir Lib Sco
    FIRE, EARTH, AIR, WATER,  # Sag Cap Aqu Pis
]


# --------------------------------------------------------------------------- #
# Domicile (rulership) — one ruler per sign.
# --------------------------------------------------------------------------- #
DOMICILE_RULER = [
    "Mars",     # Aries
    "Venus",    # Taurus
    "Mercury",  # Gemini
    "Moon",     # Cancer
    "Sun",      # Leo
    "Mercury",  # Virgo
    "Venus",    # Libra
    "Mars",     # Scorpio
    "Jupiter",  # Sagittarius
    "Saturn",   # Capricorn
    "Saturn",   # Aquarius
    "Jupiter",  # Pisces
]

# Detriment = the sign opposite a planet's domicile.
DETRIMENT_RULER = [DOMICILE_RULER[(i + 6) % 12] for i in range(12)]

# --------------------------------------------------------------------------- #
# Exaltation and fall — sign index -> planet (or None). Degree is the classic
# point of exaltation, used only for cosmetic display, not scoring.
# --------------------------------------------------------------------------- #
EXALTATION_RULER: list[Optional[str]] = [
    "Sun",      # Aries (19)
    "Moon",     # Taurus (3)
    None,       # Gemini
    "Jupiter",  # Cancer (15)
    None,       # Leo
    "Mercury",  # Virgo (15)
    "Saturn",   # Libra (21)
    None,       # Scorpio
    None,       # Sagittarius
    "Mars",     # Capricorn (28)
    None,       # Aquarius
    "Venus",    # Pisces (27)
]
EXALTATION_DEGREE: list[Optional[int]] = [
    19, 3, None, 15, None, 15, 21, None, None, 28, None, 27,
]

# Fall = the sign opposite a planet's exaltation.
FALL_RULER: list[Optional[str]] = [EXALTATION_RULER[(i + 6) % 12] for i in range(12)]


# --------------------------------------------------------------------------- #
# Triplicity — Dorothean scheme with day / night / participating rulers.
# Lilly used the Dorothean triplicities in Christian Astrology.
# --------------------------------------------------------------------------- #
# element -> (day ruler, night ruler, participating ruler)
TRIPLICITY_RULERS = {
    FIRE:  ("Sun", "Jupiter", "Saturn"),
    EARTH: ("Venus", "Moon", "Mars"),
    AIR:   ("Saturn", "Mercury", "Jupiter"),
    WATER: ("Venus", "Mars", "Moon"),
}


# --------------------------------------------------------------------------- #
# Egyptian bounds (terms) — Ptolemy's "Egyptian" table. Each entry is
# (ruler, end_degree); a planet holds the term whose end_degree it falls below.
# Ends are cumulative within the sign and always reach 30.
# --------------------------------------------------------------------------- #
EGYPTIAN_TERMS: list[list[tuple[str, float]]] = [
    # Aries
    [("Jupiter", 6), ("Venus", 12), ("Mercury", 20), ("Mars", 25), ("Saturn", 30)],
    # Taurus
    [("Venus", 8), ("Mercury", 14), ("Jupiter", 22), ("Saturn", 27), ("Mars", 30)],
    # Gemini
    [("Mercury", 6), ("Jupiter", 12), ("Venus", 17), ("Mars", 24), ("Saturn", 30)],
    # Cancer
    [("Mars", 7), ("Venus", 13), ("Mercury", 19), ("Jupiter", 26), ("Saturn", 30)],
    # Leo
    [("Jupiter", 6), ("Venus", 11), ("Saturn", 18), ("Mercury", 24), ("Mars", 30)],
    # Virgo
    [("Mercury", 7), ("Venus", 17), ("Jupiter", 21), ("Mars", 28), ("Saturn", 30)],
    # Libra
    [("Saturn", 6), ("Mercury", 14), ("Jupiter", 21), ("Venus", 28), ("Mars", 30)],
    # Scorpio
    [("Mars", 7), ("Venus", 11), ("Mercury", 19), ("Jupiter", 24), ("Saturn", 30)],
    # Sagittarius
    [("Jupiter", 12), ("Venus", 17), ("Mercury", 21), ("Saturn", 26), ("Mars", 30)],
    # Capricorn
    [("Mercury", 7), ("Jupiter", 14), ("Venus", 22), ("Saturn", 26), ("Mars", 30)],
    # Aquarius
    [("Mercury", 7), ("Venus", 13), ("Jupiter", 20), ("Mars", 25), ("Saturn", 30)],
    # Pisces
    [("Venus", 12), ("Jupiter", 16), ("Mercury", 19), ("Mars", 28), ("Saturn", 30)],
]

# --------------------------------------------------------------------------- #
# Faces (decans) — Chaldean order, three 10-degree faces per sign.
# --------------------------------------------------------------------------- #
FACE_RULERS: list[tuple[str, str, str]] = [
    ("Mars", "Sun", "Venus"),        # Aries
    ("Mercury", "Moon", "Saturn"),   # Taurus
    ("Jupiter", "Mars", "Sun"),      # Gemini
    ("Venus", "Mercury", "Moon"),    # Cancer
    ("Saturn", "Jupiter", "Mars"),   # Leo
    ("Sun", "Venus", "Mercury"),     # Virgo
    ("Moon", "Saturn", "Jupiter"),   # Libra
    ("Mars", "Sun", "Venus"),        # Scorpio
    ("Mercury", "Moon", "Saturn"),   # Sagittarius
    ("Jupiter", "Mars", "Sun"),      # Capricorn
    ("Venus", "Mercury", "Moon"),    # Aquarius
    ("Saturn", "Jupiter", "Mars"),   # Pisces
]

# Lilly's essential-dignity point values (Christian Astrology).
SCORE_DOMICILE = 5
SCORE_EXALTATION = 4
SCORE_TRIPLICITY = 3
SCORE_TERM = 2
SCORE_FACE = 1
SCORE_DETRIMENT = -5
SCORE_FALL = -4
SCORE_PEREGRINE = -5


def element_of_sign(sign_num: int) -> str:
    return _ELEMENT_BY_SIGN[sign_num % 12]


def sign_num_of(abs_pos: float) -> int:
    """Zodiac sign index (0..11) of an absolute ecliptic longitude."""
    return int(abs_pos % 360 // 30)


def degree_in_sign(abs_pos: float) -> float:
    """Degrees within the sign (0..30) of an absolute ecliptic longitude."""
    return abs_pos % 30


def ruler_of_sign(sign_num: int) -> str:
    """Traditional (domicile) ruler of a sign — used to find significators."""
    return DOMICILE_RULER[sign_num % 12]


def term_ruler(sign_num: int, deg: float) -> str:
    for ruler, end in EGYPTIAN_TERMS[sign_num % 12]:
        if deg < end:
            return ruler
    return EGYPTIAN_TERMS[sign_num % 12][-1][0]


def face_ruler(sign_num: int, deg: float) -> str:
    return FACE_RULERS[sign_num % 12][min(int(deg // 10), 2)]


def triplicity_ruler(sign_num: int, is_day: bool) -> str:
    """The operative triplicity ruler for the chart's sect (day/night)."""
    day, night, _ = TRIPLICITY_RULERS[element_of_sign(sign_num)]
    return day if is_day else night


class DignityState:
    """Which essential dignities a planet holds at a position, and its score.

    ``peregrine`` is True when the planet has no domicile/exalt/triplicity/
    term/face dignity in its own place (it may still be in detriment/fall).
    """

    def __init__(
        self,
        planet: str,
        *,
        domicile: bool,
        exaltation: bool,
        triplicity: bool,
        term: bool,
        face: bool,
        detriment: bool,
        fall: bool,
    ) -> None:
        self.planet = planet
        self.domicile = domicile
        self.exaltation = exaltation
        self.triplicity = triplicity
        self.term = term
        self.face = face
        self.detriment = detriment
        self.fall = fall
        self.peregrine = not any((domicile, exaltation, triplicity, term, face))

        score = 0
        if domicile:
            score += SCORE_DOMICILE
        if exaltation:
            score += SCORE_EXALTATION
        if triplicity:
            score += SCORE_TRIPLICITY
        if term:
            score += SCORE_TERM
        if face:
            score += SCORE_FACE
        if detriment:
            score += SCORE_DETRIMENT
        if fall:
            score += SCORE_FALL
        # A peregrine planet (and not otherwise debilitated) scores -5.
        if self.peregrine and not (detriment or fall):
            score += SCORE_PEREGRINE
        self.score = score

    def as_dict(self) -> dict:
        return {
            "planet": self.planet,
            "domicile": self.domicile,
            "exaltation": self.exaltation,
            "triplicity": self.triplicity,
            "term": self.term,
            "face": self.face,
            "detriment": self.detriment,
            "fall": self.fall,
            "peregrine": self.peregrine,
            "score": self.score,
        }


def essential_dignities(planet: str, abs_pos: float, is_day: bool) -> DignityState:
    """Evaluate a classical planet's essential dignities at a longitude.

    ``is_day`` selects the operative triplicity ruler (chart sect).
    """
    sign = sign_num_of(abs_pos)
    deg = degree_in_sign(abs_pos)

    return DignityState(
        planet,
        domicile=DOMICILE_RULER[sign] == planet,
        exaltation=EXALTATION_RULER[sign] == planet,
        triplicity=triplicity_ruler(sign, is_day) == planet,
        term=term_ruler(sign, deg) == planet,
        face=face_ruler(sign, deg) == planet,
        detriment=DETRIMENT_RULER[sign] == planet,
        fall=FALL_RULER[sign] == planet,
    )


def receptions(p1: str, pos1: float, p2: str, pos2: float, is_day: bool) -> dict:
    """Mutual/one-way reception between two planets.

    A planet *receives* another when the other sits in a sign/degree that the
    first rules by some essential dignity. We report, for each direction, the
    strongest dignity by which the host planet receives the guest.
    """

    def receiver_dignities(host: str, guest_pos: float) -> list[str]:
        sign = sign_num_of(guest_pos)
        deg = degree_in_sign(guest_pos)
        held = []
        if DOMICILE_RULER[sign] == host:
            held.append("domicile")
        if EXALTATION_RULER[sign] == host:
            held.append("exaltation")
        if triplicity_ruler(sign, is_day) == host:
            held.append("triplicity")
        if term_ruler(sign, deg) == host:
            held.append("term")
        if face_ruler(sign, deg) == host:
            held.append("face")
        return held

    # p1 receives p2 if p2 sits in p1's dignities, and vice versa.
    p1_receives_p2 = receiver_dignities(p1, pos2)
    p2_receives_p1 = receiver_dignities(p2, pos1)

    return {
        "p1_receives_p2": p1_receives_p2,
        "p2_receives_p1": p2_receives_p1,
        "mutual": bool(p1_receives_p2 and p2_receives_p1),
    }
