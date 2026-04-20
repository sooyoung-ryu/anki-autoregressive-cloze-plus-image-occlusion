import copy
import json
import re
from pathlib import Path
from urllib.parse import unquote

import aqt.reviewer
from anki.cards import Card
from aqt import gui_hooks, mw
from aqt.qt import QAction
from aqt.utils import tooltip

try:
    from anki.notetypes_pb2 import StockNotetype
    _IO_STOCK_KIND = (
        StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION
    )
    _CLOZE_STOCK_KIND = (
        StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_CLOZE
    )
except Exception:
    _IO_STOCK_KIND = 6  # fallback literal
    _CLOZE_STOCK_KIND = 5  # fallback literal

NOTETYPE_NAME = "Cloze + Image Occlusion"
F_TEXT_BEFORE = "Text Before"
F_CLOZE_BEFORE = "Cloze Before"
F_TEXT_AFTER = "Text After"
F_CLOZE_AFTER = "Cloze After"
_NEW_FIELD_NAMES = (F_TEXT_BEFORE, F_CLOZE_BEFORE, F_TEXT_AFTER, F_CLOZE_AFTER)
_review_active = False

# ── Template helpers ──────────────────────────────────────────────────────

_T1 = (
    '{{#Text Before}}<div>{{Text Before}}</div>{{/Text Before}}\n'
    '{{#Cloze Before}}<div id="ar-text1">{{cloze:Cloze Before}}</div>{{/Cloze Before}}\n'
)
_T2 = (
    '\n{{#Text After}}<div>{{Text After}}</div>{{/Text After}}'
    '\n{{#Cloze After}}<div id="ar-text2">{{cloze:Cloze After}}</div>{{/Cloze After}}'
)


def _inject_text_fields(fmt: str) -> str:
    """Inject Before fields right before the IO container and After fields right after the setup script."""
    fmt = fmt.replace(
        '<div id="image-occlusion-container">',
        _T1 + '<div id="image-occlusion-container">',
        1,
    )
    fmt = re.sub(
        r'(anki\.imageOcclusion\.setup\(\);.*?</script>)',
        r'\1' + _T2,
        fmt,
        count=1,
        flags=re.DOTALL,
    )
    return fmt


def _make_templates(io_tmpl: dict) -> tuple[str, str]:
    return _inject_text_fields(io_tmpl["qfmt"]), _inject_text_fields(io_tmpl["afmt"])

def _is_our_notetype(card: Card) -> bool:
    return card.note_type().get("name") == NOTETYPE_NAME


def _extract_cloze_texts(field_value: str, cloze_num: int) -> list[str]:
    """Return active cloze answer texts in document order, with hints stripped."""
    pattern = re.compile(r"\{\{c([\d,]+)::(.*?)\}\}", re.DOTALL)
    texts = []
    for match in pattern.finditer(field_value):
        ordinals = {
            int(part)
            for part in match.group(1).split(",")
            if part.isdigit()
        }
        if cloze_num in ordinals:
            texts.append(match.group(2).split("::")[0])
    return texts


# ── Notetype creation ─────────────────────────────────────────────────────


def _find_stock_cloze_notetype():
    """Return the user's stock Cloze notetype."""
    for nt in mw.col.models.all():
        if nt.get("originalStockKind") == _CLOZE_STOCK_KIND:
            return nt
    return mw.col.models.by_name("Cloze")  # fallback for older Anki


def _get_cloze_css() -> str:
    nt = _find_stock_cloze_notetype()
    return nt.get("css", "") if nt else ""


def _find_stock_io_notetype():
    """Return the first notetype with IMAGE_OCCLUSION stock kind (excluding ours)."""
    for nt in mw.col.models.all():
        if nt.get("name") == NOTETYPE_NAME:
            continue
        if nt.get("originalStockKind") == _IO_STOCK_KIND:
            return nt
    return None


# Result codes returned by _ensure_notetype for _manual_setup to act on.
_OK = "ok"
_ALREADY_EXISTS = "already_exists"
_NO_IO = "no_io"
_FIELD_CONFLICT = "field_conflict"
_DUMP_PATH = Path("/tmp/arclozeio-question-dump.json")
_DEBUG_LOG_PATH = Path("/tmp/arclozeio-debug-log.jsonl")


def _ensure_notetype() -> str:
    mm = mw.col.models
    if mm.by_name(NOTETYPE_NAME):
        return _ALREADY_EXISTS

    io_nt = _find_stock_io_notetype()
    if io_nt is None:
        return _NO_IO  # user hasn't initialized IO yet; will retry on next profile open

    new_nt = copy.deepcopy(io_nt)
    new_nt["id"] = 0
    new_nt["name"] = NOTETYPE_NAME
    new_nt["usn"] = -1

    existing_names = {f["name"].lower() for f in new_nt["flds"]}
    if any(n.lower() in existing_names for n in _NEW_FIELD_NAMES):
        return _FIELD_CONFLICT

    new_nt["flds"].insert(0, mm.new_field(F_CLOZE_BEFORE))
    new_nt["flds"].insert(0, mm.new_field(F_TEXT_BEFORE))
    new_nt["flds"].append(mm.new_field(F_TEXT_AFTER))
    new_nt["flds"].append(mm.new_field(F_CLOZE_AFTER))
    for i, fld in enumerate(new_nt["flds"]):
        fld["ord"] = i

    tmpl = new_nt["tmpls"][0]
    tmpl["ord"] = 0
    tmpl["qfmt"], tmpl["afmt"] = _make_templates(tmpl)

    cloze_css = _get_cloze_css()
    if cloze_css:
        new_nt["css"] = new_nt.get("css", "") + "\n" + cloze_css

    mm.add_dict(new_nt)
    return _OK


gui_hooks.profile_did_open.append(_ensure_notetype)


def _manual_setup() -> None:
    status = _ensure_notetype()
    if status == _OK:
        tooltip(f"Created '{NOTETYPE_NAME}' note type.")
    elif status == _ALREADY_EXISTS:
        tooltip(f"'{NOTETYPE_NAME}' already exists.")
    elif status == _NO_IO:
        tooltip(
            "Create one Image Occlusion note first (to initialize the IO note "
            "type), then run this again."
        )
    elif status == _FIELD_CONFLICT:
        names = ", ".join(f"'{n}'" for n in _NEW_FIELD_NAMES)
        tooltip(
            f"Cannot create '{NOTETYPE_NAME}': source Image Occlusion notetype "
            f"already has one of the required field names ({names}). Rename the "
            f"conflicting field and retry."
        )


def _add_menu_action() -> None:
    action = QAction(f"Setup '{NOTETYPE_NAME}' Note Type", mw)
    action.triggered.connect(_manual_setup)
    mw.form.menuTools.addAction(action)


gui_hooks.main_window_did_init.append(_add_menu_action)


# ── Review hooks ──────────────────────────────────────────────────────────


def _on_question_shown(card: Card) -> None:
    global _review_active
    _review_active = False
    if not _is_our_notetype(card):
        return
    for path in (_DUMP_PATH, _DEBUG_LOG_PATH):
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass

    cloze_num = card.ord + 1
    note = card.note()
    before_texts = _extract_cloze_texts(note[F_CLOZE_BEFORE], cloze_num) if F_CLOZE_BEFORE in note else []
    after_texts = _extract_cloze_texts(note[F_CLOZE_AFTER], cloze_num) if F_CLOZE_AFTER in note else []

    payload = json.dumps({"text1": before_texts, "text2": after_texts})
    mw.reviewer.web.eval(f"arclozeio.init({payload});")
    _review_active = True


def _on_answer_shown(card: Card) -> None:  # noqa: ARG001
    global _review_active
    _review_active = False
    if _is_our_notetype(card):
        mw.reviewer.web.eval("arclozeio.disable();")


def _on_shortcuts_will_change(state: str, shortcuts: list) -> None:
    if state != "review":
        return
    for i, (key, fn) in enumerate(shortcuts):
        if key == " ":
            original_fn = fn

            def space_handler(orig=original_fn) -> None:
                if _review_active:
                    mw.reviewer.web.eval("arclozeio.revealNext();")
                else:
                    orig()

            shortcuts[i] = (" ", space_handler)
            break


def _on_webview_will_set_content(web_content, context) -> None:
    if not isinstance(context, aqt.reviewer.Reviewer):
        return
    pkg = mw.addonManager.addonFromModule(__name__)
    web_content.js.append(f"/_addons/{pkg}/web/reviewer.js")


def _on_js_message(handled: tuple, message: str, context) -> tuple:
    if not isinstance(context, aqt.reviewer.Reviewer):
        return handled
    if message.startswith("arclozeioLog:"):
        payload = unquote(message.removeprefix("arclozeioLog:"))
        try:
            data = json.loads(payload)
        except Exception as exc:
            tooltip(f"Failed to decode arclozeio log: {exc}")
            return (True, None)

        try:
            with _DEBUG_LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(data, ensure_ascii=False) + "\n")
        except Exception as exc:
            tooltip(f"Failed to append debug log: {exc}")
            return (True, None)
        return (True, None)
    if not message.startswith("arclozeioDump:"):
        return handled

    payload = unquote(message.removeprefix("arclozeioDump:"))
    try:
        data = json.loads(payload)
    except Exception as exc:
        tooltip(f"Failed to decode arclozeio dump: {exc}")
        return (True, None)

    try:
        _DUMP_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        tooltip(f"Failed to write dump file: {exc}")
        return (True, None)

    tooltip(f"Saved arclozeio question dump to {_DUMP_PATH}")
    return (True, None)


mw.addonManager.setWebExports(__name__, r"web/.*\.js")
gui_hooks.reviewer_did_show_question.append(_on_question_shown)
gui_hooks.reviewer_did_show_answer.append(_on_answer_shown)
gui_hooks.state_shortcuts_will_change.append(_on_shortcuts_will_change)
gui_hooks.webview_did_receive_js_message.append(_on_js_message)
gui_hooks.webview_will_set_content.append(_on_webview_will_set_content)
