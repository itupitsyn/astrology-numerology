"""Plain-language readings of what a transit means for an ordinary day.

The chart layer says "Mars square natal Mercury at 19:37". That is true and
useless to almost everyone. This module turns each finding into a sentence about
the day: what area of life it touches, and what it tends to feel like.

**The reading hangs on the natal point and the tone, not on the transiting
planet.** That is the whole design, and it was not the obvious choice: the first
version keyed the wording off the transiting body, which reads fine in isolation
and collapses in practice. The Moon is the fastest mover, so it produces most of
a day's findings — and every line came out saying "multa depends on your mood".
Four identical sentences in a five-line forecast.

So:

  * the **natal point** decides which area of life is in play, and each area has
    its own concrete wording for each tone — 12 x 3 hand-written readings;
  * the **aspect** picks the tone: easy, tense, or simply prominent;
  * the **transiting planet** adds at most a short colouring clause, and adds
    nothing at all for the Moon, whose texture *is* the ordinary texture of a
    day.

Everything here is phrased as a tendency, never as an event that will happen.
"Reactions run sharper this evening" is the honest version of a claim; "you will
have a fight at 19:37" is not, and a reader who believes it is worse off. The
same rule is stated to the model in the interpretation prompt.
"""

from __future__ import annotations

from typing import Optional

EASY = "easy"
TENSE = "tense"
FOCUS = "focus"

_ASPECT_TONE = {
    "trine": EASY,
    "sextile": EASY,
    "square": TENSE,
    "opposition": TENSE,
    "conjunction": FOCUS,
}

# The heart of the module: what each area of life feels like under each tone.
_READING = {
    "Sun": {
        EASY: "чувствуете себя на своём месте, вас слышно и видно",
        TENSE: "легко задеть самолюбие — не всё сказанное сегодня про вас",
        FOCUS: "день про вас: хорошо заявить о себе и показать сделанное",
    },
    "Moon": {
        EASY: "дома спокойно, легко понять, чего вам на самом деле хочется",
        TENSE: "эмоции ближе к поверхности, мелочи задевают сильнее обычного",
        FOCUS: "тянет к своим и к домашним делам, настроение выходит на первый план",
    },
    "Mercury": {
        EASY: "разговоры складываются — хорошее время звонить и договариваться",
        TENSE: "легко не так понять и не так быть понятым: перечитайте важное перед отправкой",
        FOCUS: "день насыщен разговорами и мелкими решениями, информации много",
    },
    "Venus": {
        EASY: "с людьми тепло: хорошо мириться, отдыхать и порадовать себя",
        TENSE: "в отношениях или в тратах может кольнуть — не лучший день для крупных покупок",
        FOCUS: "на первом плане отношения и деньги: чего вам хочется и чего это стоит",
    },
    "Mars": {
        EASY: "хорошо взяться за отложенное — сил и решимости хватает",
        TENSE: "раздражение накапливается: легко сорваться и наломать дров в спешке",
        FOCUS: "день про действие, тянет решать вопросы напрямую",
    },
    "Jupiter": {
        EASY: "видно перспективу: хорошо строить планы и просить о большем",
        TENSE: "легко переоценить силы и пообещать лишнего",
        FOCUS: "мысли о большем — подходящий момент прикинуть, куда двигаться",
    },
    "Saturn": {
        EASY: "хорошо идёт скучная нужная работа, за которую обычно не сесть",
        TENSE: "всё упирается в сроки и обязательства, ощущение, что тянете в гору",
        FOCUS: "день про ответственность: что действительно ваше, а что взяли зря",
    },
    "Uranus": {
        EASY: "легко взглянуть на привычное иначе, приходят неожиданные решения",
        TENSE: "планы могут сбиться, тянет всё бросить и сделать по-своему",
        FOCUS: "хочется воздуха и перемен, привычная колея раздражает",
    },
    "Neptune": {
        EASY: "хорошо для отдыха, музыки и всего, что не требует чёткости",
        TENSE: "туман в голове: легко устать, обмануться и потерять нить",
        FOCUS: "границы размыты — день не для точных расчётов",
    },
    "Pluto": {
        EASY: "хватает сил посмотреть на неприятное прямо и что-то с этим сделать",
        TENSE: "давит контроль, свой или чужой; старая тема поднимается снова",
        FOCUS: "на поверхность выходит то, что давно копилось",
    },
    "Ascendant": {
        EASY: "вы производите хорошее впечатление, легко знакомиться и начинать",
        TENSE: "вас могут понять не так, как вам хотелось бы",
        FOCUS: "день про то, как вы выглядите со стороны",
    },
    "Medium_Coeli": {
        EASY: "хорошее время показать результат и говорить о работе",
        TENSE: "по работе напряжение: сроки или начальство требуют больше обычного",
        FOCUS: "на первом плане дела и репутация",
    },
}

# A short colouring clause from the transiting planet. The Moon is deliberately
# absent: it is the ordinary texture of any day, so naming it adds nothing and,
# because it drives most findings, repeating it turns the forecast to mush.
_TRANSIT_COLOUR = {
    "Sun": "Тема выходит на свет.",
    "Mercury": "Придёт через разговоры и переписку.",
    "Venus": "Через людей, деньги и то, что хочется.",
    "Mars": "Быстро и резко.",
    "Jupiter": "С размахом — легко хватить лишку.",
    "Saturn": "Медленно и всерьёз: это надолго, не на один день.",
    "Uranus": "Внезапно и не по плану.",
    "Neptune": "Смутно, без чётких очертаний.",
    "Pluto": "Глубоко и всерьёз: это надолго, не на один день.",
}


def natal_aspect_meaning(transit: str, natal: str, aspect: str) -> Optional[str]:
    """A day-level reading of a transit to a natal point."""
    tone = _ASPECT_TONE.get(aspect)
    readings = _READING.get(natal)
    if not tone or not readings:
        return None

    sentence = readings[tone].capitalize()
    colour = _TRANSIT_COLOUR.get(transit)
    return f"{sentence}. {colour}" if colour else f"{sentence}."


_SKY_MEANING = {
    EASY: "Общий фон дня складывается легко — это чувствуется всеми, не только вами",
    TENSE: "Общий фон дня напряжённый: вокруг больше спешки и трения, и дело не лично в вас",
    FOCUS: "Общий фон дня насыщенный — события идут гуще обычного",
}


def sky_aspect_meaning(aspect: str) -> Optional[str]:
    """Weather rather than biography: a transit-to-transit aspect colours the day
    for everybody, so it is phrased impersonally and stays short."""
    tone = _ASPECT_TONE.get(aspect)
    return _SKY_MEANING.get(tone) if tone else None


# --------------------------------------------------------------------------- #
# Discrete events
# --------------------------------------------------------------------------- #
# What a planet governs, for events where no natal point is involved.
_PLANET_DOMAIN = {
    "Sun": "в том, на что уходит внимание",
    "Moon": "в настроении",
    "Mercury": "в разговорах и делах",
    "Venus": "в отношениях и тратах",
    "Mars": "в том, куда уходят силы",
    "Jupiter": "в планах и ожиданиях",
    "Saturn": "в обязанностях",
    "Uranus": "в потребности что-то менять",
    "Neptune": "в настрое и мечтах",
    "Pluto": "в глубинных темах",
}

_MOON_PHASE_MEANING = {
    "Новолуние": "Точка старта: подходящий момент наметить новое, а не подводить итоги",
    "Первая четверть": "Становится ясно, чего задуманному не хватает",
    "Полнолуние": "Всё обостряется и становится видно: эмоции на пике, мелочи задевают сильнее",
    "Последняя четверть": "Время убавлять, а не набирать: хорошо завершать и отпускать",
}


def ingress_meaning(planet: str) -> Optional[str]:
    domain = _PLANET_DOMAIN.get(planet)
    if not domain:
        return None
    if planet == "Moon":
        return f"Меняется тон дня {domain} — переключение чувствуется в пределах пары часов"
    return f"Меняется тон {domain} на ближайшее время"


def station_meaning(planet: str, retrograde: bool) -> Optional[str]:
    domain = _PLANET_DOMAIN.get(planet)
    if not domain:
        return None
    if retrograde:
        return f"Пора вернуться к незакрытому {domain}: сейчас это про пересмотр, а не про новое"
    return f"Затянувшееся {domain} снова сдвигается с места"


def moon_phase_meaning(phase: str) -> Optional[str]:
    return _MOON_PHASE_MEANING.get(phase)


VOID_OF_COURSE_MEANING = (
    "Пустой промежуток: начатое сейчас обычно ни к чему не приводит, "
    "а договорённости легко рассыпаются. Хорошо для рутины и отдыха"
)
