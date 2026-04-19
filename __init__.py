import copy
import json
import re

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
except Exception:
    _IO_STOCK_KIND = 6  # fallback literal

NOTETYPE_NAME = "Cloze + Image Occlusion"
F_TEXT1 = "Text1"
F_TEXT2 = "Text2"

# ── Template helpers ──────────────────────────────────────────────────────

_T1 = '{{#Text1}}<div id="ar-text1">{{cloze:Text1}}</div>{{/Text1}}\n'
_T2 = '\n{{#Text2}}<div id="ar-text2">{{cloze:Text2}}</div>{{/Text2}}'


def _inject_text_fields(fmt: str) -> str:
    """Inject Text1 right before the IO container and Text2 right after the setup script."""
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

# ── State ──────────────────────────────────────────────────────────────────

_active = False


def _is_our_notetype(card: Card) -> bool:
    return card.note_type().get("name") == NOTETYPE_NAME


def _extract_cloze_texts(field_value: str, cloze_num: int) -> list[str]:
    """Return cN cloze answer texts in document order, with hints stripped."""
    pattern = re.compile(r"\{\{c" + str(cloze_num) + r"::(.*?)\}\}", re.DOTALL)
    return [m.group(1).split("::")[0] for m in pattern.finditer(field_value)]


# ── Notetype creation ─────────────────────────────────────────────────────


def _find_stock_io_notetype():
    """Return the first notetype with IMAGE_OCCLUSION stock kind (excluding ours)."""
    for nt in mw.col.models.all():
        if nt.get("name") == NOTETYPE_NAME:
            continue
        if nt.get("originalStockKind") == _IO_STOCK_KIND:
            return nt
    return None


def _try_create_stock_io_notetype() -> bool:
    """Trigger Anki backend to add the stock IO notetype if missing."""
    try:
        # Anki's backend exposes this; the exact method varies by version.
        from anki.stdmodels import get_stock_notetypes
        for (name, func) in get_stock_notetypes(mw.col):
            # Identify the IO entry by name match (localized) or by inspecting result
            try:
                nt = func(mw.col)
                if nt.get("originalStockKind") == _IO_STOCK_KIND:
                    mw.col.models.add_dict(nt) if hasattr(mw.col.models, "add_dict") else mw.col.models.add(nt)
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def _ensure_notetype() -> None:
    mm = mw.col.models
    if mm.by_name(NOTETYPE_NAME):
        return

    io_nt = _find_stock_io_notetype()
    if io_nt is None:
        _try_create_stock_io_notetype()
        io_nt = _find_stock_io_notetype()
    if io_nt is None:
        return  # user hasn't initialized IO yet; will retry on next profile open

    new_nt = copy.deepcopy(io_nt)
    new_nt["id"] = 0
    new_nt["name"] = NOTETYPE_NAME
    new_nt["usn"] = -1

    text1 = mm.new_field(F_TEXT1)
    new_nt["flds"].insert(0, text1)
    text2 = mm.new_field(F_TEXT2)
    new_nt["flds"].append(text2)
    for i, fld in enumerate(new_nt["flds"]):
        fld["ord"] = i

    tmpl = new_nt["tmpls"][0]
    tmpl["ord"] = 0
    tmpl["qfmt"], tmpl["afmt"] = _make_templates(tmpl)

    if hasattr(mm, "add_dict"):
        mm.add_dict(new_nt)
    else:
        mm.add(new_nt)


gui_hooks.profile_did_open.append(_ensure_notetype)


def _manual_setup() -> None:
    if mw.col.models.by_name(NOTETYPE_NAME):
        tooltip(f"'{NOTETYPE_NAME}' already exists.")
        return
    _ensure_notetype()
    if mw.col.models.by_name(NOTETYPE_NAME):
        tooltip(f"Created '{NOTETYPE_NAME}' note type.")
    else:
        tooltip(
            "Create one Image Occlusion note first (to initialize the IO note "
            "type), then run this again."
        )


def _add_menu_action() -> None:
    action = QAction(f"Setup '{NOTETYPE_NAME}' Note Type", mw)
    action.triggered.connect(_manual_setup)
    mw.form.menuTools.addAction(action)


gui_hooks.main_window_did_init.append(_add_menu_action)


# ── Review hooks ──────────────────────────────────────────────────────────


def _on_question_shown(card: Card) -> None:
    global _active
    _active = False
    if not _is_our_notetype(card):
        return

    cloze_num = card.ord + 1
    note = card.note()
    text1_texts = _extract_cloze_texts(note[F_TEXT1], cloze_num) if F_TEXT1 in note else []
    text2_texts = _extract_cloze_texts(note[F_TEXT2], cloze_num) if F_TEXT2 in note else []

    _active = True
    payload = json.dumps({"text1": text1_texts, "text2": text2_texts})
    mw.reviewer.web.eval(f"arclozeio.init({payload});")


def _on_answer_shown(card: Card) -> None:
    global _active
    _active = False


def _on_shortcuts_will_change(state: str, shortcuts: list) -> None:
    if state != "review":
        return
    for i, (key, fn) in enumerate(shortcuts):
        if key == " ":
            original_fn = fn

            def space_handler(orig=original_fn) -> None:
                if _active:
                    mw.reviewer.web.eval("arclozeio.revealNext();")
                else:
                    orig()

            shortcuts[i] = (" ", space_handler)
            break


def _on_js_message(handled: tuple, message: str, context) -> tuple:
    if isinstance(context, aqt.reviewer.Reviewer) and message == "arShowAnswer":
        global _active
        _active = False
        mw.reviewer._getTypedAnswer()
        return (True, None)
    return handled


def _on_webview_will_set_content(web_content, context) -> None:
    if not isinstance(context, aqt.reviewer.Reviewer):
        return
    pkg = mw.addonManager.addonFromModule(__name__)
    web_content.js.append(f"/_addons/{pkg}/web/reviewer.js")


mw.addonManager.setWebExports(__name__, r"web/.*\.js")
gui_hooks.reviewer_did_show_question.append(_on_question_shown)
gui_hooks.reviewer_did_show_answer.append(_on_answer_shown)
gui_hooks.state_shortcuts_will_change.append(_on_shortcuts_will_change)
gui_hooks.webview_did_receive_js_message.append(_on_js_message)
gui_hooks.webview_will_set_content.append(_on_webview_will_set_content)
