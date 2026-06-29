from __future__ import annotations

import json
import math
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

STYLE_LABELS = (
    "apa7",
    "harvard-ctr",
    "chicago-notes-bib",
    "vancouver",
    "ieee",
    "mla9",
    "unknown",
)

SMART_QUOTES_RE = re.compile(r"[“”„‟«»]")
SMART_APOSTROPHES_RE = re.compile(r"[‘’‚‛]")
STYLE_YEAR_FRAGMENT = r"(?:1[6-9]|20)\d{2}[a-z]?"
STYLE_YEAR_REGEX = re.compile(rf"\b{STYLE_YEAR_FRAGMENT}\b", re.IGNORECASE)
BOOK_PUBLISHER_RE = re.compile(
    r"\b(?:press|publisher|publishing|university|routledge|springer|wiley|elsevier|verlag|editora|editorial|dial[eé]tica|hanser|birkh[aä]user|apress|palgrave|editores?|publications?|peter\s+lang(?:\s+\w+)?|british standards|智勝出版)\b",
    re.IGNORECASE,
)
REPOSITORY_RE = re.compile(
    r"\b(?:Center for Open Science|Open Science Framework|OSF|Research Square(?: Platform LLC)?|SSRN|TechRxiv|Preprints(?:\.org)?|bioRxiv|medRxiv|arXiv|Elsevier BV)\b",
    re.IGNORECASE,
)
RFC_WEB_RE = re.compile(r"\b(?:RFC Editor|Internet Engineering Task Force)\b", re.IGNORECASE)
CONFERENCE_RE = re.compile(
    r"\b(?:conference|symposium|workshop|congress|meeting|proceedings|proc\.?|abstracts publication|poster|presentation|jornadas|seminar|seminario)\b",
    re.IGNORECASE,
)
INSTITUTION_TAIL_RE = re.compile(r",\s*[^,.;]{4,260};\s*(?:19|20)\d{2}\.?$", re.IGNORECASE)
URL_RE = re.compile(r"\bhttps?://[^\s\"'<>]+", re.IGNORECASE)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s\"'<>]+", re.IGNORECASE)
TRUNCATED_IDENTIFIER_TAIL_RE = re.compile(
    r"(?:https?://[^\s\"'<>]*\.{3,}|doi:\s*10\.[^\s\"'<>]*\.{3,}|10\.\d{4,9}/[^\s\"'<>]*\.{3,})",
    re.IGNORECASE,
)
IDENTIFIER_TAIL_FRAGMENT = r"(?:https?://[^\s\"'<>]+|doi:\s*10\.[^\s\"'<>]+|10\.[^\s\"'<>]+)"


@dataclass(frozen=True)
class StyleModelBundle:
    model_version: str
    feature_version: str
    biases: dict[str, float]
    weights: dict[str, dict[str, float]]
    source: str


@dataclass(frozen=True)
class StyleDecisionPolicyBundle:
    threshold_set_version: str
    supported_exact_styles: frozenset[str]
    known_unsupported_exact_styles: frozenset[str]
    family_by_style: dict[str, str]
    operating_mode: str
    require_calibration_for_primary: bool
    calibration_available: bool
    abstain_on_missing_primary_calibration: bool
    thresholds: dict[str, float]
    profile_thresholds: dict[str, dict[str, float]]
    reason_codes: dict[str, str]
    source: str


STYLE_FAMILY_BY_STYLE: dict[str, str] = {
    "apa7": "author_date",
    "harvard-ctr": "author_date",
    "chicago-notes-bib": "notes_bibliography",
    "mla9": "notes_bibliography",
    "vancouver": "numeric",
    "ieee": "numeric",
    "ama": "numeric",
    "acs": "numeric",
    "chicago-author-date": "author_date",
    "unknown": "unknown",
}

SUPPORTED_EXACT_STYLES = frozenset(
    (
        "apa7",
        "harvard-ctr",
        "chicago-notes-bib",
        "vancouver",
        "ieee",
        "mla9",
    )
)

KNOWN_UNSUPPORTED_EXACT_STYLE_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    (
        "ama",
        "numeric",
        re.compile(r"^\s*\d+\.\s+[A-Z].*?(?:19|20)\d{2};\d+", re.IGNORECASE),
    ),
    (
        "acs",
        "numeric",
        re.compile(r"^\s*\(\d+\)\s+[A-Z]", re.IGNORECASE),
    ),
    (
        "chicago-author-date",
        "author_date",
        re.compile(
            rf"^[^\[][^.]+,\s*(?:19|20)\d{{2}}[a-z]?\.\s+.+?\.\s+.+$",
            re.IGNORECASE,
        ),
    ),
)

DEFAULT_STYLE_THRESHOLDS: dict[str, float] = {
    "exact_confidence": 0.82,
    "exact_margin": 0.12,
    "family_confidence": 0.67,
    "ood_max": 0.55,
}

DEFAULT_STYLE_PROFILE_THRESHOLDS: dict[str, dict[str, float]] = {
    "clean-structured": {},
    "noisy-short": {
        "exact_confidence": 0.9,
        "exact_margin": 0.18,
        "family_confidence": 0.73,
        "ood_max": 0.45,
    },
    "unstructured-long": {
        "exact_confidence": 0.88,
        "exact_margin": 0.16,
        "family_confidence": 0.71,
        "ood_max": 0.5,
    },
}

DEFAULT_STYLE_REASON_CODES: dict[str, str] = {
    "SUPPORTED_EXACT_COMMIT": "Model exact style commit passed all policy thresholds.",
    "HEURISTIC_AGREEMENT": "Heuristic and model agree on top style.",
    "HEURISTIC_DISAGREEMENT": "Heuristic and model disagree on top style.",
    "UNSUPPORTED_EXACT_OR_LOW_MARGIN": "Input matched unsupported exact style cues or had low style margin.",
    "LOW_CONFIDENCE_EXACT": "Exact style confidence or margin was below policy thresholds.",
    "FAMILY_ONLY_FALLBACK": "Family confidence passed while exact commit was withheld.",
    "OOD_RISK": "Out-of-distribution risk exceeded policy tolerance.",
    "MISSING_CALIBRATION_PRIMARY": "Primary mode requires calibration artifact before model commits are allowed.",
    "INPUT_NOT_CITATION_LIKE": "Input did not match citation-like structure.",
    "UNKNOWN_OR_OOD": "Policy abstained due insufficient confidence or unknown style evidence.",
}

DEFAULT_BIASES: dict[str, float] = {
    "apa7": 0.0,
    "harvard-ctr": 0.0,
    "chicago-notes-bib": 0.0,
    "vancouver": 0.0,
    "ieee": 0.0,
    "mla9": 0.0,
    "unknown": -0.2,
}

DEFAULT_WEIGHTS: dict[str, dict[str, float]] = {
    "apa7": {
        "year_parenthesized": 2.8,
        "period_after_year": 2.6,
        "ampersand_authors": 1.4,
        "apa_sparse_container": 2.8,
        "apa_thesis_bracket": 3.1,
        "apa_long_author_parenthesized": 3.4,
        "apa_front_year_identifier_tail": 3.0,
        "apa_front_year_book_identifier": 3.2,
        "apa_corporate_monograph_identifier": 4.0,
        "apa_patent_title_year": 4.2,
        "journal_locator_tail": 2.0,
        "article_number_tail": 1.6,
        "bare_year_after_quote": -1.0,
        "available_at": -2.0,
        "bracketed_enumerator": -2.4,
    },
    "harvard-ctr": {
        "year_parenthesized": 2.2,
        "no_period_after_year": 2.2,
        "available_at": 2.8,
        "quoted_title": 0.6,
        "harvard_corporate_report": 3.3,
        "harvard_patent_available": 3.8,
        "thesis_or_dissertation": 1.3,
        "period_after_year": -1.6,
        "bracketed_enumerator": -2.0,
    },
    "chicago-notes-bib": {
        "quoted_title": 2.0,
        "chicago_journal_year_pages": 3.2,
        "chicago_year_pages_only": 3.4,
        "chicago_year_pages_identifier_tail": 4.2,
        "chicago_container_year_pages": 3.6,
        "container_in_prefix": 2.7,
        "chicago_quoted_tail_year_period": 3.1,
        "chicago_dissertation_tail": 3.6,
        "chicago_webpage_rfc": 4.0,
        "chicago_patent_issued": 4.0,
        "publisher_year_tail": 1.9,
        "mla_publisher_year_comma_identifier": -2.8,
        "mla_research_square_preprint": -2.6,
        "mla_quoted_year_container": -2.4,
        "mla_quoted_tail_year_comma": -2.6,
        "mla_quoted_tail_identifier": -2.6,
        "mla_repository_year_identifier": -2.8,
        "mla_thesis_identifier": -2.8,
        "mla_patent_number_identifier": -2.8,
        "mla_techrxiv_preprint": -2.8,
        "bracketed_enumerator": -2.0,
    },
    "vancouver": {
        "bracketed_enumerator": 2.8,
        "semicolon_year_tail": 3.0,
        "vancouver_journal": 3.6,
        "vancouver_semicolon_publisher": 3.1,
        "vancouver_institution_semicolon_year": 3.6,
        "vancouver_dissertation_tail": 3.2,
        "vancouver_semicolon_monograph": 3.8,
        "vancouver_bare_year_identifier": 3.4,
        "vancouver_semicolon_identifier": 4.2,
        "vancouver_rfc_numeric_web": 4.4,
        "vancouver_quoted_preprint_identifier": 3.9,
        "vancouver_numeric_thesis_identifier": 6.4,
        "quoted_title": -1.2,
        "quoted_publisher_tail": 1.4,
        "ieee_vol_no_pp_year_end": -3.0,
        "ieee_online_available": -3.4,
        "ieee_comma_year_doi_book": -2.6,
        "ieee_report_quote_year": -2.8,
        "publisher_year_tail": -0.4,
    },
    "ieee": {
        "bracketed_enumerator": 2.8,
        "quoted_title": 1.8,
        "ieee_vol_no_pp_year_end": 4.0,
        "ieee_book_tail": 3.5,
        "ieee_comma_year_doi_book": 4.0,
        "ieee_online_available": 4.2,
        "ieee_report_quote_year": 3.9,
        "publisher_year_tail": 1.4,
        "vancouver_semicolon_monograph": -2.8,
        "vancouver_bare_year_identifier": -2.6,
        "vancouver_semicolon_identifier": -2.8,
        "vancouver_rfc_numeric_web": -3.2,
        "vancouver_quoted_preprint_identifier": -2.4,
        "vancouver_numeric_thesis_identifier": -5.2,
        "semicolon_year_tail": -2.2,
        "vancouver_institution_semicolon_year": -2.4,
        "quoted_publisher_tail": -0.5,
    },
    "mla9": {
        "quoted_title": 2.1,
        "bare_year_after_quote": 2.8,
        "mla_quoted_year_container": 3.0,
        "mla_journal_vol_no_year": 2.8,
        "mla_quoted_tail_year_comma": 3.3,
        "mla_quoted_tail_identifier": 3.7,
        "mla_publisher_year_comma_identifier": 3.6,
        "mla_repository_year_identifier": 4.0,
        "mla_thesis_identifier": 4.1,
        "mla_patent_number_identifier": 4.0,
        "mla_research_square_preprint": 3.8,
        "mla_techrxiv_preprint": 3.9,
        "publisher_year_tail": 1.1,
        "chicago_quoted_tail_year_period": -2.4,
        "chicago_container_year_pages": -2.6,
        "chicago_year_pages_identifier_tail": -2.8,
        "chicago_dissertation_tail": -2.4,
        "chicago_webpage_rfc": -2.4,
        "chicago_patent_issued": -2.6,
        "container_in_prefix": -1.8,
        "chicago_year_pages_only": -2.6,
        "bracketed_enumerator": -2.3,
    },
    "unknown": {
        "weak_signal_profile": 1.8,
        "truncated_url_profile": 1.2,
    },
}


def normalize_style_text(text: str) -> str:
    return (
        text.strip()
        .replace("&amp;", "&")
        .replace("\u00A0", " ")
        .replace("\u2013", "–")
        .replace("\u2014", "—")
    )


def predict_style_batch(texts: list[str]) -> list[dict[str, Any]]:
    bundle = load_style_bundle()
    policy = load_style_decision_policy()
    return [predict_style(text, bundle, policy) for text in texts]


def predict_style(
    text: str,
    bundle: StyleModelBundle | None = None,
    policy_bundle: StyleDecisionPolicyBundle | None = None,
) -> dict[str, Any]:
    model = bundle or load_style_bundle()
    policy = policy_bundle or load_style_decision_policy()
    normalized = normalize_style_text(text)
    features = extract_style_features(normalized)
    scored = _score_style_candidates(normalized, features, model)
    top_style = scored["top_style"]
    top_confidence = scored["top_confidence"]
    secondary_style = scored["secondary_style"]
    secondary_confidence = scored["secondary_confidence"]
    margin = round(max(0.0, top_confidence - secondary_confidence), 4)
    input_profile = classify_style_input_profile(normalized, features)
    heuristic_style = detect_heuristic_style_hint(normalized)
    known_unsupported_style = detect_known_unsupported_exact_style(normalized, features)

    decision = _apply_style_decision_policy(
        text=normalized,
        top_style=top_style,
        top_confidence=top_confidence,
        secondary_style=secondary_style,
        secondary_confidence=secondary_confidence,
        margin=margin,
        input_profile=input_profile,
        heuristic_style=heuristic_style,
        known_unsupported_style=known_unsupported_style,
        features=features,
        policy=policy,
    )

    secondary_payload = (
        None
        if secondary_style is None
        else {
            "style": secondary_style,
            "confidence": secondary_confidence,
        }
    )

    return {
        "decision": decision["decision"],
        "family": decision["family"],
        "exactStyle": decision["exact_style"],
        "knownUnsupportedExact": decision["known_unsupported_exact"],
        "supportedExact": decision["supported_exact"],
        "abstain": decision["abstain"],
        "confidence": decision["confidence"],
        "margin": margin,
        "oodScore": decision["ood_score"],
        "reasonCodes": decision["reason_codes"],
        "inputProfile": input_profile,
        "heuristicAgreement": decision["heuristic_agreement"],
        "modelVersion": model.model_version,
        "featureVersion": model.feature_version,
        "thresholdSetVersion": policy.threshold_set_version,
        "policyMode": policy.operating_mode,
        "calibrationRequiredForPrimary": policy.require_calibration_for_primary,
        "calibrationAvailable": policy.calibration_available,
        "primary": {
            "style": top_style,
            "confidence": top_confidence,
        },
        "secondary": secondary_payload,
    }


def _score_style_candidates(
    normalized: str,
    features: dict[str, float],
    model: StyleModelBundle,
) -> dict[str, Any]:
    if (
        features.get("truncated_url_profile", 0.0) == 1.0
        and not features.get("quoted_title", 0.0)
        and not features.get("bracketed_enumerator", 0.0)
    ):
        return {
            "top_style": "unknown",
            "top_confidence": 0.92,
            "secondary_style": None,
            "secondary_confidence": 0.0,
        }

    if (
        re.search(
            rf'^[^"]{{2,240}}\.\s+.+?[.?!]\s+.+?,\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}',
            normalized,
            re.IGNORECASE,
        )
        and not features.get("bracketed_enumerator", 0.0)
        and not features.get("quoted_title", 0.0)
        and not bool(re.search(r"\bIn:\s+", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bPatent\b", normalized, re.IGNORECASE))
    ):
        return {
            "top_style": "mla9",
            "top_confidence": 0.86,
            "secondary_style": "chicago-notes-bib",
            "secondary_confidence": 0.14,
        }

    if (
        features.get("vancouver_semicolon_identifier", 0.0) == 1.0
        or features.get("vancouver_bare_year_identifier", 0.0) == 1.0
        or features.get("vancouver_quoted_preprint_identifier", 0.0) == 1.0
        or features.get("vancouver_numeric_thesis_identifier", 0.0) == 1.0
        or features.get("vancouver_rfc_numeric_web", 0.0) == 1.0
    ):
        return {
            "top_style": "vancouver",
            "top_confidence": 0.88,
            "secondary_style": "ieee",
            "secondary_confidence": 0.08,
        }

    if features.get("chicago_webpage_rfc", 0.0) == 1.0:
        return {
            "top_style": "chicago-notes-bib",
            "top_confidence": 0.84,
            "secondary_style": "mla9",
            "secondary_confidence": 0.12,
        }

    if features.get("chicago_container_year_pages", 0.0) == 1.0:
        return {
            "top_style": "chicago-notes-bib",
            "top_confidence": 0.86,
            "secondary_style": "mla9",
            "secondary_confidence": 0.1,
        }

    if features.get("chicago_year_pages_identifier_tail", 0.0) == 1.0:
        return {
            "top_style": "chicago-notes-bib",
            "top_confidence": 0.87,
            "secondary_style": "mla9",
            "secondary_confidence": 0.09,
        }

    if features.get("apa_corporate_monograph_identifier", 0.0) == 1.0:
        return {
            "top_style": "apa7",
            "top_confidence": 0.84,
            "secondary_style": "harvard-ctr",
            "secondary_confidence": 0.12,
        }

    if features.get("apa_patent_title_year", 0.0) == 1.0:
        return {
            "top_style": "apa7",
            "top_confidence": 0.88,
            "secondary_style": "harvard-ctr",
            "secondary_confidence": 0.08,
        }

    raw_scores: dict[str, float] = {style: model.biases.get(style, 0.0) for style in STYLE_LABELS}
    for style, weights in model.weights.items():
        raw_scores.setdefault(style, 0.0)
        for feature, weight in weights.items():
            raw_scores[style] += features.get(feature, 0.0) * weight

    ranked = sorted(raw_scores.items(), key=lambda item: item[1], reverse=True)
    top_style, top_score = ranked[0]
    second_style, second_score = ranked[1]
    has_strong_exact_profile = any(
        features.get(feature, 0.0) == 1.0
        for feature in (
            "apa_front_year_identifier_tail",
            "apa_front_year_book_identifier",
            "apa_corporate_monograph_identifier",
            "apa_patent_title_year",
            "apa_long_author_parenthesized",
            "harvard_corporate_report",
            "harvard_patent_available",
            "chicago_journal_year_pages",
            "chicago_year_pages_only",
            "chicago_container_year_pages",
            "chicago_quoted_tail_year_period",
            "chicago_patent_issued",
            "vancouver_journal",
            "vancouver_semicolon_monograph",
            "vancouver_bare_year_identifier",
            "vancouver_semicolon_identifier",
            "vancouver_rfc_numeric_web",
            "vancouver_quoted_preprint_identifier",
            "vancouver_numeric_thesis_identifier",
            "ieee_vol_no_pp_year_end",
            "ieee_comma_year_doi_book",
            "ieee_online_available",
            "ieee_report_quote_year",
            "mla_quoted_tail_year_comma",
            "mla_quoted_tail_identifier",
            "mla_publisher_year_comma_identifier",
            "mla_repository_year_identifier",
            "mla_thesis_identifier",
            "mla_patent_number_identifier",
            "mla_research_square_preprint",
            "mla_techrxiv_preprint",
        )
    )

    if top_style != "unknown":
        evidence = top_score - raw_scores.get("unknown", 0.0)
        margin = top_score - second_score
        evidence_floor = 0.65 if has_strong_exact_profile else 1.1
        low_margin = margin < (0.28 if has_strong_exact_profile else 0.45)
        low_score = top_score < (2.7 if has_strong_exact_profile else 3.2)
        if evidence < evidence_floor or (low_margin and low_score):
            top_style = "unknown"
            top_score = raw_scores.get("unknown", 0.0)
            ranked = sorted(raw_scores.items(), key=lambda item: item[1], reverse=True)
            second_style, second_score = ranked[0] if ranked[0][0] != "unknown" else ranked[1]

    confidences = softmax_scores({style: score for style, score in ranked[:3]})
    primary_confidence = round(confidences.get(top_style, 0.4), 4)
    secondary_style = second_style if second_style != "unknown" else None
    secondary_confidence = round(confidences.get(second_style, 0.0), 4) if secondary_style else None

    return {
        "top_style": top_style,
        "top_confidence": primary_confidence,
        "secondary_style": secondary_style,
        "secondary_confidence": secondary_confidence or 0.0,
    }


def _apply_style_decision_policy(
    *,
    text: str,
    top_style: str,
    top_confidence: float,
    secondary_style: str | None,
    secondary_confidence: float,
    margin: float,
    input_profile: str,
    heuristic_style: str | None,
    known_unsupported_style: str | None,
    features: dict[str, float],
    policy: StyleDecisionPolicyBundle,
) -> dict[str, Any]:
    thresholds = dict(policy.thresholds)
    thresholds.update(policy.profile_thresholds.get(input_profile, {}))
    reason_codes: list[str] = []

    if (
        policy.operating_mode == "primary"
        and policy.require_calibration_for_primary
        and not policy.calibration_available
        and policy.abstain_on_missing_primary_calibration
    ):
        reason_codes.append("MISSING_CALIBRATION_PRIMARY")
        return {
            "decision": "unknown_or_ood",
            "family": "unknown",
            "exact_style": None,
            "known_unsupported_exact": known_unsupported_style,
            "supported_exact": False,
            "abstain": True,
            "confidence": round(max(top_confidence, 0.4), 4),
            "ood_score": estimate_ood_score(text, features, top_confidence),
            "reason_codes": reason_codes,
            "heuristic_agreement": False,
        }

    heuristic_agreement = heuristic_style is not None and heuristic_style == top_style
    if heuristic_style is not None:
        reason_codes.append(
            "HEURISTIC_AGREEMENT" if heuristic_agreement else "HEURISTIC_DISAGREEMENT"
        )
        if heuristic_agreement:
            thresholds["exact_confidence"] = max(
                0.0, float(thresholds["exact_confidence"]) - 0.03
            )
            thresholds["exact_margin"] = max(0.0, float(thresholds["exact_margin"]) - 0.02)
        else:
            thresholds["exact_confidence"] = min(
                0.99, float(thresholds["exact_confidence"]) + 0.05
            )
            thresholds["exact_margin"] = min(0.99, float(thresholds["exact_margin"]) + 0.03)

    ood_score = estimate_ood_score(text, features, top_confidence)
    family = resolve_family_from_style(top_style, policy.family_by_style)
    family_confidence = top_confidence if family != "unknown" else 0.0
    if family == "unknown" and secondary_style is not None:
        secondary_family = resolve_family_from_style(
            secondary_style, policy.family_by_style
        )
        if secondary_family != "unknown":
            family = secondary_family
            family_confidence = max(family_confidence, secondary_confidence)

    if is_not_citation_like(text, features):
        reason_codes.append("INPUT_NOT_CITATION_LIKE")
        return {
            "decision": "not_citation_like",
            "family": "unknown",
            "exact_style": None,
            "known_unsupported_exact": None,
            "supported_exact": False,
            "abstain": True,
            "confidence": round(max(0.35, top_confidence), 4),
            "ood_score": ood_score,
            "reason_codes": reason_codes,
            "heuristic_agreement": heuristic_agreement,
        }

    should_route_unsupported = (
        known_unsupported_style is not None
        and known_unsupported_style in policy.known_unsupported_exact_styles
        and (
            top_style == "unknown"
            or margin < float(thresholds["exact_margin"]) + 0.04
            or top_confidence < float(thresholds["exact_confidence"]) + 0.04
        )
    )
    if should_route_unsupported:
        reason_codes.append("UNSUPPORTED_EXACT_OR_LOW_MARGIN")
        unsupported_family = resolve_family_from_style(
            known_unsupported_style, policy.family_by_style
        )
        return {
            "decision": "known_unsupported_exact",
            "family": unsupported_family,
            "exact_style": known_unsupported_style,
            "known_unsupported_exact": known_unsupported_style,
            "supported_exact": False,
            "abstain": True,
            "confidence": round(max(top_confidence, 0.76), 4),
            "ood_score": ood_score,
            "reason_codes": reason_codes,
            "heuristic_agreement": heuristic_agreement,
        }

    if (
        top_style in policy.supported_exact_styles
        and top_style != "unknown"
        and top_confidence >= float(thresholds["exact_confidence"])
        and margin >= float(thresholds["exact_margin"])
        and ood_score <= float(thresholds["ood_max"])
    ):
        reason_codes.append("SUPPORTED_EXACT_COMMIT")
        return {
            "decision": "supported_exact",
            "family": resolve_family_from_style(top_style, policy.family_by_style),
            "exact_style": top_style,
            "known_unsupported_exact": None,
            "supported_exact": True,
            "abstain": False,
            "confidence": round(top_confidence, 4),
            "ood_score": ood_score,
            "reason_codes": reason_codes,
            "heuristic_agreement": heuristic_agreement,
        }

    if ood_score > float(thresholds["ood_max"]):
        reason_codes.append("OOD_RISK")
    else:
        reason_codes.append("LOW_CONFIDENCE_EXACT")

    if (
        family != "unknown"
        and family_confidence >= float(thresholds["family_confidence"])
    ):
        reason_codes.append("FAMILY_ONLY_FALLBACK")
        return {
            "decision": "family_only",
            "family": family,
            "exact_style": None,
            "known_unsupported_exact": known_unsupported_style,
            "supported_exact": False,
            "abstain": True,
            "confidence": round(family_confidence, 4),
            "ood_score": ood_score,
            "reason_codes": reason_codes,
            "heuristic_agreement": heuristic_agreement,
        }

    reason_codes.append("UNKNOWN_OR_OOD")
    return {
        "decision": "unknown_or_ood",
        "family": "unknown",
        "exact_style": None,
        "known_unsupported_exact": known_unsupported_style,
        "supported_exact": False,
        "abstain": True,
        "confidence": round(max(top_confidence, 0.4), 4),
        "ood_score": ood_score,
        "reason_codes": reason_codes,
        "heuristic_agreement": heuristic_agreement,
    }


def classify_style_input_profile(text: str, features: dict[str, float]) -> str:
    token_count = len(text.split())
    if token_count <= 8 or features.get("truncated_url_profile", 0.0) == 1.0:
        return "noisy-short"
    if token_count >= 45 or text.count(". ") >= 5:
        return "unstructured-long"
    return "clean-structured"


def resolve_family_from_style(
    style: str | None, family_by_style: dict[str, str] | None = None
) -> str:
    if style is None:
        return "unknown"
    mapping = family_by_style or STYLE_FAMILY_BY_STYLE
    return mapping.get(style, "unknown")


def detect_heuristic_style_hint(text: str) -> str | None:
    if re.search(r"^\s*\[\d+\]", text):
        return "vancouver"
    if re.search(r"^\s*\d+\.\s+[A-Z].*?(?:19|20)\d{2};\d+", text):
        return "ama"
    if re.search(r"^\s*\(\d+\)\s+[A-Z]", text):
        return "acs"
    if re.search(r"\(\d{4}[a-z]?\)", text):
        return "apa7"
    if re.search(r"\bAvailable at:\s*https?://", text, re.IGNORECASE):
        return "harvard-ctr"
    if re.search(r'"[^"]{4,}"', text):
        return "mla9"
    return None


def detect_known_unsupported_exact_style(
    text: str,
    features: dict[str, float],
) -> str | None:
    for style, _family, pattern in KNOWN_UNSUPPORTED_EXACT_STYLE_PATTERNS:
        if pattern.search(text):
            if style == "chicago-author-date" and features.get("year_parenthesized", 0.0) == 1.0:
                continue
            return style
    return None


def estimate_ood_score(
    text: str,
    features: dict[str, float],
    top_confidence: float,
) -> float:
    score = max(0.0, 1.0 - top_confidence)
    if features.get("weak_signal_profile", 0.0) == 1.0:
        score += 0.22
    if features.get("truncated_url_profile", 0.0) == 1.0:
        score += 0.26
    if len(text.split()) <= 8:
        score += 0.12
    has_anchor = bool(DOI_RE.search(text) or URL_RE.search(text) or STYLE_YEAR_REGEX.search(text))
    if not has_anchor:
        score += 0.18
    return round(min(1.0, score), 4)


def is_not_citation_like(text: str, features: dict[str, float]) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    if len(stripped.split()) <= 3 and not (DOI_RE.search(stripped) or URL_RE.search(stripped)):
        return True
    has_core_cues = bool(
        DOI_RE.search(stripped)
        or URL_RE.search(stripped)
        or STYLE_YEAR_REGEX.search(stripped)
        or features.get("quoted_title", 0.0) == 1.0
        or features.get("bracketed_enumerator", 0.0) == 1.0
    )
    if not has_core_cues and features.get("weak_signal_profile", 0.0) == 1.0:
        return True
    return False


def extract_style_features(text: str) -> dict[str, float]:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = SMART_QUOTES_RE.sub('"', normalized)
    normalized = SMART_APOSTROPHES_RE.sub("'", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    backbone = strip_trailing_identifier_tail(normalized)
    stripped_enum = re.sub(r"^\s*(?:\[\d+\]|\d+[.)]|\(\d+\))\s+", "", normalized)

    features: dict[str, float] = {}
    add = lambda key, value=True: features.__setitem__(key, 1.0 if value else 0.0)

    add("bracketed_enumerator", bool(re.match(r"^\s*\[\d+\]", normalized)))
    add("numeric_enumerator", bool(re.match(r"^\s*(?:\d+[.)]|\(\d+\))", normalized)))
    add("quoted_title", '"' in normalized)
    add("ampersand_authors", "&" in normalized)
    add("available_at", bool(re.search(r"\bAvailable at:", normalized, re.IGNORECASE)))
    add("container_in_prefix", bool(re.search(r'\.\s+In\s+', normalized)))
    add("thesis_or_dissertation", bool(re.search(r"\b(?:dissertation|thesis|doctoral dissertation|master'?s thesis)\b", normalized, re.IGNORECASE)))
    add("apa_thesis_bracket", bool(re.search(r"\[[^\]]*(?:dissertation|thesis|doctoral dissertation|master'?s thesis)[^\]]*\]", normalized, re.IGNORECASE)))
    add("year_parenthesized", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)", normalized)))
    add("period_after_year", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\.\s+", normalized)))
    add("no_period_after_year", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\s+[^.]", normalized)) and not features.get("period_after_year"))
    add(
        "apa_long_author_parenthesized",
        not features.get("bracketed_enumerator")
        and not features.get("quoted_title")
        and not features.get("available_at")
        and bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\.\s+", backbone))
        and (len(re.findall(r",\s*", normalized)) >= 6 or "…" in normalized)
        and bool(re.search(rf'^[^"]{{0,720}}\({STYLE_YEAR_FRAGMENT}\)\.\s+[^.]+?\.\s+[^.]+$', backbone)),
    )
    add(
        "apa_front_year_identifier_tail",
        not features.get("bracketed_enumerator")
        and features.get("year_parenthesized")
        and not features.get("quoted_title")
        and not features.get("available_at")
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and bool(re.search(rf'^[^"]{{2,240}}\({STYLE_YEAR_FRAGMENT}\)\.\s+[^.]+?\.\s+[^.]+$', backbone)),
    )
    add(
        "apa_front_year_book_identifier",
        not features.get("bracketed_enumerator")
        and features.get("year_parenthesized")
        and not features.get("quoted_title")
        and not features.get("available_at")
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and bool(BOOK_PUBLISHER_RE.search(backbone))
        and bool(re.search(rf'^[^"]{{2,240}}\({STYLE_YEAR_FRAGMENT}\)\.\s+[^.]+?\.\s+[^.]+$', backbone)),
    )
    add(
        "apa_corporate_monograph_identifier",
        not features.get("bracketed_enumerator")
        and features.get("year_parenthesized")
        and not features.get("quoted_title")
        and not features.get("available_at")
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and not bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE))
        and bool(re.search(rf'^[^"]{{2,260}}\.\s*\({STYLE_YEAR_FRAGMENT}\)\.\s+[^.]+?\.\s+[^.]+$', backbone)),
    )
    add(
        "apa_patent_title_year",
        not features.get("bracketed_enumerator")
        and features.get("year_parenthesized")
        and not features.get("quoted_title")
        and not features.get("available_at")
        and bool(URL_RE.search(normalized))
        and bool(re.search(r"\bPatent(?:\s+Application)?\s+No\.?\s*[A-Z]{2,}[A-Z0-9/-]{4,}\b", normalized, re.IGNORECASE))
        and bool(re.search(r"https?://(?:www\.)?patents\.google\.com/patent/", normalized, re.IGNORECASE))
        and bool(re.search(rf'^[^"]{{4,360}}\s+\(Patent(?:\s+Application)?\s+No\.?\s*[A-Z0-9/-]+\)\.\s*\({STYLE_YEAR_FRAGMENT}\)\.?$', backbone, re.IGNORECASE)),
    )
    add("bare_year_after_quote", bool(re.search(rf'"[^"]{{4,}}"\.?\s*{STYLE_YEAR_FRAGMENT},', backbone)))
    add("journal_locator_tail", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\.\s+.+?\.\s+.+?,\s*(?:\d+|\?)(?:\((?:[^)]+|\?)\))?(?:,\s*(?:pp?\.\s*)?[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$", backbone)))
    add("article_number_tail", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\.\s+.+?\.\s+.+?,\s*(?:\d+|\?),\s*[A-Za-z]?\d[\w-]{{4,}}\.?$", backbone)))
    add("apa_sparse_container", bool(re.search(rf"\({STYLE_YEAR_FRAGMENT}\)\.\s+[^.]+?\.\s+[^.]+\.?$", backbone)) and not features.get("available_at") and (bool(CONFERENCE_RE.search(backbone)) or bool(re.search(r"\b[A-ZА-Я]{4,}\b", backbone))))
    add("harvard_corporate_report", bool(re.search(rf"^[^\"]{{2,220}}\({STYLE_YEAR_FRAGMENT}\)\s+.+\.\s+[^.]+?\.\s+Available at:\s*{IDENTIFIER_TAIL_FRAGMENT}", normalized, re.IGNORECASE)))
    add("mla_quoted_year_container", bool(re.search(rf'^[^\"]{{2,220}}\.\s*"[^"]{{4,}}"\.?\s*{STYLE_YEAR_FRAGMENT},\s*(.+)$', strip_url_stub(backbone), re.IGNORECASE)) and not bool(re.search(rf'^[^\"]{{2,220}}\.\s*"[^"]{{4,}}"\.?\s*{STYLE_YEAR_FRAGMENT},\s*[A-Za-zIVXLCDM]*\d', strip_url_stub(backbone), re.IGNORECASE)))
    add(
        "mla_quoted_tail_year_comma",
        not features.get("bracketed_enumerator")
        and '"' in backbone
        and bool(
            re.search(
                rf',\s*{STYLE_YEAR_FRAGMENT},\s*(?:(?:pp?\.\s*[A-Za-z]?\d[\w.–-]*(?:\s*[–-]\s*[A-Za-z]?\d[\w.–-]*)?,\s*)?{IDENTIFIER_TAIL_FRAGMENT})',
                normalized,
                re.IGNORECASE,
            )
        ),
    )
    add(
        "mla_quoted_tail_identifier",
        not features.get("bracketed_enumerator")
        and '"' in backbone
        and bool(
            re.search(
                rf',\s*{STYLE_YEAR_FRAGMENT},\s*(?:(?:pp?\.\s*[A-Za-z]?\d[\w.–-]*(?:\s*[–-]\s*[A-Za-z]?\d[\w.–-]*)?,\s*)?{IDENTIFIER_TAIL_FRAGMENT})',
                normalized,
                re.IGNORECASE,
            )
        )
        and (
            bool(BOOK_PUBLISHER_RE.search(backbone))
            or bool(CONFERENCE_RE.search(backbone))
            or bool(REPOSITORY_RE.search(normalized))
        ),
    )
    add("mla_journal_vol_no_year", bool(re.search(r'"[^"]{4,}"\.?[.,]?\s+.+?,\s*(?:vol\.\s*(?:\d+|\?)(?:,\s*no(?:s)?\.\s*[^,]+)?|no(?:s)?\.\s*[^,]+),\s*(?:19|20)\d{2}', backbone, re.IGNORECASE)))
    add("chicago_journal_year_pages", bool(re.search(r'".{4,}"\.?\s+.+?\s+\d+(?:,\s*no(?:s)?\.?\s*[^()]+)?\s*\((?:19|20)\d{2}\)', backbone, re.IGNORECASE)))
    add("chicago_year_pages_only", bool(re.search(rf'^[^\"]{{2,220}}\.\s*"[^"]{{4,}}"\.?\s*{STYLE_YEAR_FRAGMENT},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$', strip_url_stub(backbone), re.IGNORECASE)))
    add(
        "chicago_year_pages_identifier_tail",
        not features.get("bracketed_enumerator", 0.0)
        and features.get("quoted_title", 0.0) == 1.0
        and not bool(re.search(r"\bvol\.|\bno(?:s)?\.|\bpp?\.", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf'^[^"]{{2,360}}\.\s*"[^"]{{4,}}"\.?\s*{STYLE_YEAR_FRAGMENT},\s*[A-Za-zIVXLCDM0-9][\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM0-9][\w–-]*)?\.?\s*{IDENTIFIER_TAIL_FRAGMENT}$',
                normalized,
                re.IGNORECASE,
            )
        ),
    )
    add(
        "chicago_container_year_pages",
        not features.get("bracketed_enumerator", 0.0)
        and features.get("quoted_title", 0.0) == 1.0
        and bool(
            re.search(
                rf'^[^"]{{2,220}}\.\s*"[^"]{{4,}}"\.?\s+[^.]+,\s*{STYLE_YEAR_FRAGMENT},\s*[A-Za-zIVXLCDM]*\d[\w–-]*(?:\s*[–-]\s*[A-Za-zIVXLCDM]*\d+)?\.?$',
                strip_url_stub(backbone),
                re.IGNORECASE,
            )
        ),
    )
    add(
        "chicago_quoted_tail_year_period",
        not features.get("bracketed_enumerator")
        and '"' in backbone
        and bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT}\.?\s*(?:https?:\/\/|doi:\s*10\.|10\.)', normalized, re.IGNORECASE))
        and (
            bool(re.search(r"\bIn\s+", backbone, re.IGNORECASE))
            or bool(re.search(r"\bPreprint,\s+", backbone, re.IGNORECASE))
            or bool(BOOK_PUBLISHER_RE.search(backbone))
            or bool(CONFERENCE_RE.search(backbone))
        ),
    )
    add("vancouver_journal", bool(re.search(r"\b(?:19|20)\d{2}(?:\s+[A-Za-z]{3}\s+\d{1,2})?;(?:\d+|\?)(?:\((?:[^)]+|\?)\))?(?::[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$", backbone)))
    add("semicolon_year_tail", bool(re.search(r";\s*(?:19|20)\d{2}\.?$", strip_url_stub(backbone))))
    add("vancouver_semicolon_publisher", features.get("bracketed_enumerator", 0.0) == 1.0 and features.get("semicolon_year_tail", 0.0) == 1.0 and bool(INSTITUTION_TAIL_RE.search(strip_url_stub(backbone))))
    add(
        "vancouver_institution_semicolon_year",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and not features.get("quoted_title")
        and bool(re.search(rf',\s*[^,;]{{4,260}};\s*{STYLE_YEAR_FRAGMENT}\.?(?:\s*{IDENTIFIER_TAIL_FRAGMENT})?$', normalized, re.IGNORECASE)),
    )
    add(
        "vancouver_dissertation_tail",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and bool(re.search(rf'\b(?:dissertation|thesis)\.\s+[^,;]{{4,260}},\s*{STYLE_YEAR_FRAGMENT}\.?(?:\s*{IDENTIFIER_TAIL_FRAGMENT})?$', normalized, re.IGNORECASE)),
    )
    add(
        "vancouver_semicolon_monograph",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and not bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf';\s*{STYLE_YEAR_FRAGMENT}(?:,\s*p{{1,2}}\.?\s*[A-Za-z]?\d[\w–-]*(?:\s*[–-]\s*\d+)?)?\.?$',
                strip_url_stub(backbone),
                re.IGNORECASE,
            )
        ),
    )
    add(
        "vancouver_bare_year_identifier",
        bool(features.get("bracketed_enumerator") or features.get("numeric_enumerator"))
        and bool(DOI_RE.search(normalized))
        and not features.get("quoted_title")
        and not bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bvol\.|\bno\.|\bpp?\.", normalized, re.IGNORECASE))
        and not bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT}\.?$', strip_url_stub(strip_trailing_identifier_tail(stripped_enum)), re.IGNORECASE))
        and bool(re.search(rf"\b{STYLE_YEAR_FRAGMENT}\.?$", strip_url_stub(strip_trailing_identifier_tail(stripped_enum)), re.IGNORECASE)),
    )
    add(
        "vancouver_semicolon_identifier",
        bool(features.get("bracketed_enumerator") or features.get("numeric_enumerator"))
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and not bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bvol\.|\bno\.|\bpp?\.", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf'(?:;\s*{STYLE_YEAR_FRAGMENT}|,\s*[^,.;]{{4,260}};\s*{STYLE_YEAR_FRAGMENT})\.?$',
                strip_url_stub(strip_trailing_identifier_tail(stripped_enum)),
                re.IGNORECASE,
            )
        ),
    )
    add(
        "vancouver_quoted_preprint_identifier",
        bool(features.get("bracketed_enumerator") or features.get("numeric_enumerator"))
        and features.get("quoted_title")
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and not bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bvol\.|\bno\.|\bpp?\.", normalized, re.IGNORECASE))
        and bool(re.search(rf'\(\s*preprint\s*\)\s*{STYLE_YEAR_FRAGMENT}\.?$', strip_url_stub(strip_trailing_identifier_tail(stripped_enum)), re.IGNORECASE)),
    )
    add(
        "vancouver_numeric_thesis_identifier",
        bool(features.get("bracketed_enumerator") or features.get("numeric_enumerator"))
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and not features.get("quoted_title")
        and bool(re.search(r"\b(?:dissertation|thesis)\b", normalized, re.IGNORECASE))
        and bool(re.search(r"\b(?:universidade|university|universidad|institute|institut|school|faculty|faculdade|documentation centre|library)\b", normalized, re.IGNORECASE))
        and bool(re.search(rf"\b(?:dissertation|thesis)\.\s+[^,.;]{{4,260}},\s*{STYLE_YEAR_FRAGMENT}\.?(?:\s*{IDENTIFIER_TAIL_FRAGMENT})?$", normalized, re.IGNORECASE)),
    )
    add(
        "vancouver_rfc_numeric_web",
        bool(features.get("bracketed_enumerator") or features.get("numeric_enumerator"))
        and not features.get("quoted_title")
        and bool(URL_RE.search(normalized))
        and not bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bvol\.|\bno\.|\bpp?\.", normalized, re.IGNORECASE))
        and bool(RFC_WEB_RE.search(normalized) or re.search(r"https?://(?:www\.)?rfc-editor\.org/", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf'(?:^|\.?\s)(?:RFC Editor|Internet Engineering Task Force)(?:,\s*Internet Engineering Task Force)?\s+{STYLE_YEAR_FRAGMENT}\.?$',
                strip_url_stub(strip_trailing_identifier_tail(stripped_enum)),
                re.IGNORECASE,
            )
        ),
    )
    add("quoted_publisher_tail", bool(re.search(r',\s*[^,;]{0,80}"[^"]{2,120}"[^;]{0,80};\s*(?:19|20)\d{2}\.?$', strip_url_stub(backbone))))
    add("ieee_vol_no_pp_year_end", bool(re.search(r'"[^"]{4,}"\s*,?\s*.+?,\s*vol\.?\s*(?:\d+|\?),\s*(?:no\.?\s*[^,]+,\s*)?p{1,2}\.?\s*[A-Za-z]?\d[\w–-]*,\s*(?:19|20)\d{2}\.?$', normalized, re.IGNORECASE)))
    add("ieee_book_tail", features.get("bracketed_enumerator", 0.0) == 1.0 and bool(DOI_RE.search(normalized)) and not features.get("quoted_title", 0.0) and bool(re.search(r'.+\.\s+[^.]{2,180},\s*(?:1[6-9]|20)\d{2}\.?$', strip_url_stub(strip_trailing_identifier_tail(stripped_enum)), re.IGNORECASE)))
    add(
        "ieee_comma_year_doi_book",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and bool(DOI_RE.search(normalized))
        and not features.get("quoted_title", 0.0)
        and not features.get("semicolon_year_tail", 0.0)
        and bool(
            re.search(rf',\s*{STYLE_YEAR_FRAGMENT}\.?\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)
            or re.search(rf',\s*{STYLE_YEAR_FRAGMENT}\.?$', strip_url_stub(strip_trailing_identifier_tail(stripped_enum)), re.IGNORECASE)
        ),
    )
    add(
        "ieee_report_quote_year",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and features.get("quoted_title", 0.0) == 1.0
        and bool(DOI_RE.search(normalized) or URL_RE.search(normalized))
        and bool(re.search(rf'^.+?"[^"]{{4,}}"(?:,)?\s+[^,;]{{4,220}},\s*{STYLE_YEAR_FRAGMENT}\.?\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)),
    )
    add(
        "ieee_online_available",
        features.get("bracketed_enumerator", 0.0) == 1.0
        and bool(re.search(r"\[Online\]", normalized, re.IGNORECASE))
        and bool(re.search(r"\bAvailable:\s*https?://", normalized, re.IGNORECASE)),
    )
    add(
        "mla_publisher_year_comma_identifier",
        not features.get("bracketed_enumerator", 0.0)
        and not features.get("quoted_title", 0.0)
        and not bool(re.search(r"\bIn:\s+", normalized, re.IGNORECASE))
        and not bool(re.search(r"\bPatent\b", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf'^[^"]{{2,240}}\.\s+.+?[.?!]\s+.+?,\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}',
                normalized,
                re.IGNORECASE,
            )
            or (
                bool(BOOK_PUBLISHER_RE.search(normalized))
                and bool(
                    re.search(
                        rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}',
                        normalized,
                        re.IGNORECASE,
                    )
                )
            )
        ),
    )
    add(
        "mla_repository_year_identifier",
        not features.get("bracketed_enumerator", 0.0)
        and features.get("quoted_title", 0.0) == 1.0
        and bool(REPOSITORY_RE.search(normalized) or re.search(r"\b(?:repository|preprint)\b", normalized, re.IGNORECASE))
        and bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)),
    )
    add(
        "mla_research_square_preprint",
        not features.get("bracketed_enumerator", 0.0)
        and bool(re.search(r"\bResearch Square(?: Platform LLC)?\b", normalized, re.IGNORECASE))
        and bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)),
    )
    add(
        "mla_techrxiv_preprint",
        not features.get("bracketed_enumerator", 0.0)
        and bool(re.search(r"\b(?:TechRxiv|Preprints(?:\.org)?)\b", normalized, re.IGNORECASE) or re.search(r"\btechrxiv\b", normalized, re.IGNORECASE))
        and bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)),
    )
    add(
        "mla_thesis_identifier",
        not features.get("bracketed_enumerator", 0.0)
        and not features.get("quoted_title", 0.0)
        and bool(
            re.search(
                rf'^[^"]{{2,360}}\.\s+.+?\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}\.?\s+.+?,\s*(?:doctoral dissertation|phd thesis|master\'?s thesis|dissertation|thesis)\.?$',
                normalized,
                re.IGNORECASE,
            )
        ),
    )
    add(
        "mla_patent_number_identifier",
        not features.get("bracketed_enumerator", 0.0)
        and not features.get("quoted_title", 0.0)
        and not features.get("available_at", 0.0)
        and bool(re.search(r"\bno\.\s*[A-Z]{2,}[A-Z0-9/-]{4,}\b", normalized, re.IGNORECASE))
        and bool(re.search(rf',\s*{STYLE_YEAR_FRAGMENT},\s*{IDENTIFIER_TAIL_FRAGMENT}', normalized, re.IGNORECASE)),
    )
    add(
        "chicago_dissertation_tail",
        not features.get("bracketed_enumerator", 0.0)
        and features.get("quoted_title", 0.0) == 1.0
        and bool(
            re.search(
                rf'"[^"]{{4,}}(?:[.?!])?"\.?\s+(?:Dissertation|Thesis),\s+.+?,\s*{STYLE_YEAR_FRAGMENT}\.?$',
                strip_url_stub(backbone),
                re.IGNORECASE,
            )
        ),
    )
    add(
        "chicago_webpage_rfc",
        not features.get("bracketed_enumerator", 0.0)
        and features.get("quoted_title", 0.0) == 1.0
        and not features.get("available_at", 0.0)
        and bool(URL_RE.search(normalized))
        and bool(RFC_WEB_RE.search(normalized) or re.search(r"https?://(?:www\.)?rfc-editor\.org/", normalized, re.IGNORECASE))
        and bool(
            re.search(
                rf'^[^"]{{2,220}}\.\s*"[^"]{{4,}}"\.?\s+(?:[^.]+,\s+)?(?:[^.]+,\s+)?{STYLE_YEAR_FRAGMENT}\.?\s*{IDENTIFIER_TAIL_FRAGMENT}',
                normalized,
                re.IGNORECASE,
            )
        ),
    )
    add(
        "chicago_patent_issued",
        not features.get("bracketed_enumerator", 0.0)
        and bool(re.search(r"\bPatent\s+(?:Application\s+No\.\s+)?[A-Z]{2,}[A-Z0-9/-]{4,},\s*issued\s*(?:19|20)\d{2}\.?", normalized, re.IGNORECASE))
        and bool(re.search(r"https?://(?:www\.)?patents\.google\.com/patent/", normalized, re.IGNORECASE)),
    )
    add(
        "harvard_patent_available",
        not features.get("bracketed_enumerator", 0.0)
        and bool(re.search(rf'^"[^"]{{4,}}"\s+\({STYLE_YEAR_FRAGMENT}\)\.\s+Available at:\s*https?://(?:www\.)?patents\.google\.com/patent/', normalized, re.IGNORECASE)),
    )
    add("publisher_year_tail", bool(re.search(r",\s*(?:1[6-9]|20)\d{2}\.?$", strip_url_stub(backbone))))
    add("weak_signal_profile", sum(features.values()) <= 2.0)
    add("truncated_url_profile", bool(TRUNCATED_IDENTIFIER_TAIL_RE.search(normalized)))

    return features


def strip_url_stub(text: str) -> str:
    return re.sub(r"\b(?:https?:\/\/[^\s]*|doi:?)\s*$", "", text, flags=re.IGNORECASE).strip().rstrip(".,;:")


def strip_trailing_identifier_tail(text: str) -> str:
    doi_match = DOI_RE.search(text)
    url_match = URL_RE.search(text)
    candidates = [match.group(0) for match in (doi_match, url_match) if match is not None]
    if not candidates:
        return text
    identifier = min(candidates, key=text.index)
    index = text.index(identifier)
    if index < len(text) * 0.68:
        return text
    return text[:index].strip().rstrip(".,;:")


def softmax_scores(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}
    top = max(scores.values())
    exp_scores = {key: math.exp((value - top) / 1.1) for key, value in scores.items()}
    total = sum(exp_scores.values()) or 1.0
    return {key: value / total for key, value in exp_scores.items()}


def load_style_bundle() -> StyleModelBundle:
    return _load_style_bundle_cached(tuple(resolve_style_bundle_candidates()))


@lru_cache(maxsize=1)
def _load_style_bundle_cached(candidates: tuple[str, ...]) -> StyleModelBundle:
    for raw_candidate in candidates:
        candidate = Path(raw_candidate)
        if not candidate.exists():
            continue
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        return StyleModelBundle(
            model_version=str(payload.get("modelVersion") or "style-gb-local"),
            feature_version=str(payload.get("featureVersion") or "style-features-v1"),
            biases={str(key): float(value) for key, value in (payload.get("biases") or {}).items()},
            weights={
                str(style): {str(feature): float(weight) for feature, weight in weights.items()}
                for style, weights in (payload.get("weights") or {}).items()
            },
            source=str(candidate),
        )

    return StyleModelBundle(
        model_version="style-gb-local-bootstrap",
        feature_version="style-features-v1",
        biases=dict(DEFAULT_BIASES),
        weights={style: dict(weights) for style, weights in DEFAULT_WEIGHTS.items()},
        source="built-in",
    )


def load_style_decision_policy() -> StyleDecisionPolicyBundle:
    return _load_style_decision_policy_cached(
        tuple(resolve_style_policy_file_candidates("thresholds.json")),
        tuple(resolve_style_policy_file_candidates("decision_policy.json")),
        tuple(resolve_style_policy_file_candidates("reason_codes.json")),
    )


@lru_cache(maxsize=1)
def _load_style_decision_policy_cached(
    threshold_candidates: tuple[str, ...],
    decision_policy_candidates: tuple[str, ...],
    reason_code_candidates: tuple[str, ...],
) -> StyleDecisionPolicyBundle:
    threshold_payload, threshold_source = _load_first_json_file(threshold_candidates)
    decision_payload, decision_source = _load_first_json_file(decision_policy_candidates)
    reason_payload, reason_source = _load_first_json_file(reason_code_candidates)

    threshold_set_version = str(
        threshold_payload.get("thresholdSetVersion")
        or decision_payload.get("thresholdSetVersion")
        or "policy-1"
    )
    supported_exact_styles = frozenset(
        str(value)
        for value in (
            decision_payload.get("supportedExactStyles")
            or sorted(SUPPORTED_EXACT_STYLES)
        )
        if isinstance(value, str)
    )
    known_unsupported_styles = frozenset(
        str(value)
        for value in (
            decision_payload.get("knownUnsupportedExactStyles")
            or ["ama", "acs", "chicago-author-date"]
        )
        if isinstance(value, str)
    )
    family_by_style = {
        **STYLE_FAMILY_BY_STYLE,
        **{
            str(style): str(family)
            for style, family in (decision_payload.get("familyByStyle") or {}).items()
            if isinstance(style, str) and isinstance(family, str)
        },
    }
    operating_mode = str(decision_payload.get("operatingMode") or "shadow").strip().lower()
    if operating_mode not in {"shadow", "primary"}:
        operating_mode = "shadow"
    require_calibration_for_primary = bool(
        decision_payload.get("requireCalibrationForPrimary", True)
    )
    calibration_payload = decision_payload.get("calibration")
    calibration_available = False
    if isinstance(calibration_payload, dict):
        calibration_available = bool(calibration_payload.get("available", False))
    abstain_on_missing_primary_calibration = bool(
        decision_payload.get("abstainOnMissingPrimaryCalibration", True)
    )
    thresholds = {
        **DEFAULT_STYLE_THRESHOLDS,
        **{
            str(key): float(value)
            for key, value in (threshold_payload.get("global") or {}).items()
            if isinstance(key, str)
        },
    }
    profile_thresholds: dict[str, dict[str, float]] = {
        profile: dict(values) for profile, values in DEFAULT_STYLE_PROFILE_THRESHOLDS.items()
    }
    for profile, values in (threshold_payload.get("profileThresholds") or {}).items():
        if not isinstance(profile, str) or not isinstance(values, dict):
            continue
        profile_thresholds[profile] = {
            **profile_thresholds.get(profile, {}),
            **{
                str(key): float(value)
                for key, value in values.items()
                if isinstance(key, str)
            },
        }

    reason_codes = {
        **DEFAULT_STYLE_REASON_CODES,
        **{
            str(code): str(message)
            for code, message in reason_payload.items()
            if isinstance(code, str)
        },
    }
    source_parts = [
        source
        for source in (threshold_source, decision_source, reason_source)
        if source != "built-in"
    ]

    return StyleDecisionPolicyBundle(
        threshold_set_version=threshold_set_version,
        supported_exact_styles=supported_exact_styles or SUPPORTED_EXACT_STYLES,
        known_unsupported_exact_styles=known_unsupported_styles,
        family_by_style=family_by_style,
        operating_mode=operating_mode,
        require_calibration_for_primary=require_calibration_for_primary,
        calibration_available=calibration_available,
        abstain_on_missing_primary_calibration=abstain_on_missing_primary_calibration,
        thresholds=thresholds,
        profile_thresholds=profile_thresholds,
        reason_codes=reason_codes,
        source="built-in" if not source_parts else ";".join(source_parts),
    )


def _load_first_json_file(candidates: tuple[str, ...]) -> tuple[dict[str, Any], str]:
    for raw_candidate in candidates:
        candidate = Path(raw_candidate)
        if not candidate.exists():
            continue
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return payload, str(candidate)
        except Exception:
            continue
    return {}, "built-in"


def resolve_style_bundle_candidates() -> list[str]:
    env_path = Path(__file__).resolve().parents[1] / "models" / "style-model" / "current" / "style_model.json"
    return [
        str(Path.cwd() / "models" / "style-model" / "current" / "style_model.json"),
        str(env_path),
    ]


def resolve_style_policy_file_candidates(filename: str) -> list[str]:
    env_path = (
        Path(__file__).resolve().parents[1]
        / "models"
        / "style-model"
        / "current"
        / filename
    )
    return [
        str(Path.cwd() / "models" / "style-model" / "current" / filename),
        str(env_path),
    ]
