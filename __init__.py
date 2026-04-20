import copy
import json
import re
from pathlib import Path
from urllib.parse import unquote

import aqt.reviewer
from anki.cards import Card
from anki.notetypes_pb2 import StockNotetype
from aqt import gui_hooks, mw
from aqt.qt import QAction
from aqt.utils import tooltip

_IO_STOCK_KIND = StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION
_CLOZE_STOCK_KIND = StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_CLOZE

PACKAGE_NAME = "Autoregressive Cloze + Image Occlusion"
AR_CLOZE_NAME = "Autoregressive Cloze"
AR_IO_NAME = "Autoregressive Image Occlusion"
AR_COMBINED_NAME = "Autoregressive Cloze + Image Occlusion"
DUMP_DIR = Path("/tmp/anki-arcio-dumps")
_DUMP_FILENAMES = {
    "cloze.json",
    "image-occlusion.json",
    "combined.json",
}

F_TEXT_BEFORE = "Text Before"
F_CLOZE_BEFORE = "Cloze Before"
F_TEXT_AFTER = "Text After"
F_CLOZE_AFTER = "Cloze After"
_COMBINED_FIELD_NAMES = (
    F_TEXT_BEFORE,
    F_CLOZE_BEFORE,
    F_TEXT_AFTER,
    F_CLOZE_AFTER,
)

_active_mode: str | None = None

_COMBINED_BEFORE = (
    '{{#Text Before}}<div>{{Text Before}}</div>{{/Text Before}}\n'
    '{{#Cloze Before}}<div id="ar-text1">{{cloze:Cloze Before}}</div>{{/Cloze Before}}\n'
)
_COMBINED_AFTER = (
    '\n{{#Text After}}<div>{{Text After}}</div>{{/Text After}}'
    '\n{{#Cloze After}}<div id="ar-text2">{{cloze:Cloze After}}</div>{{/Cloze After}}'
)


def _find_stock_cloze_notetype():
    for nt in mw.col.models.all():
        if nt.get("originalStockKind") == _CLOZE_STOCK_KIND:
            return nt
    return None


def _find_stock_io_notetype():
    for nt in mw.col.models.all():
        if nt.get("name") == AR_COMBINED_NAME:
            continue
        if nt.get("name") == AR_IO_NAME:
            continue
        if nt.get("originalStockKind") == _IO_STOCK_KIND:
            return nt
    return None


def _get_cloze_css() -> str:
    nt = _find_stock_cloze_notetype()
    return nt.get("css", "") if nt else ""


def _clone_notetype(source_nt: dict, name: str) -> dict:
    new_nt = copy.deepcopy(source_nt)
    new_nt["id"] = 0
    new_nt["name"] = name
    new_nt["usn"] = -1
    return new_nt


def _ensure_named_clone(name: str, source_nt: dict | None, configure=None) -> str:
    mm = mw.col.models
    if mm.by_name(name):
        return "exists"
    if source_nt is None:
        return "missing"

    new_nt = _clone_notetype(source_nt, name)
    if configure is not None:
        try:
            configure(new_nt)
        except ValueError:
            return "field_conflict"

    mm.add_dict(new_nt)
    return "created"


def _inject_combined_text_fields(fmt: str) -> str:
    if 'id="ar-text1"' not in fmt:
        fmt = fmt.replace(
            '<div id="image-occlusion-container">',
            _COMBINED_BEFORE + '<div id="image-occlusion-container">',
            1,
        )
    if 'id="ar-text2"' not in fmt:
        replaced = re.sub(
            r'(anki\.imageOcclusion\.setup\(\);.*?</script>)',
            r"\1" + _COMBINED_AFTER,
            fmt,
            count=1,
            flags=re.DOTALL,
        )
        fmt = replaced if replaced != fmt else fmt + _COMBINED_AFTER
    return fmt


def _configure_combined_notetype(nt: dict) -> None:
    mm = mw.col.models

    existing_names = {f["name"].lower() for f in nt["flds"]}
    if any(name.lower() in existing_names for name in _COMBINED_FIELD_NAMES):
        raise ValueError(
            "source Image Occlusion notetype already contains one of the "
            "required field names"
        )

    nt["flds"].insert(0, mm.new_field(F_CLOZE_BEFORE))
    nt["flds"].insert(0, mm.new_field(F_TEXT_BEFORE))
    nt["flds"].append(mm.new_field(F_TEXT_AFTER))
    nt["flds"].append(mm.new_field(F_CLOZE_AFTER))
    for i, fld in enumerate(nt["flds"]):
        fld["ord"] = i

    tmpl = nt["tmpls"][0]
    tmpl["ord"] = 0
    tmpl["qfmt"] = _inject_combined_text_fields(tmpl["qfmt"])
    tmpl["afmt"] = _inject_combined_text_fields(tmpl["afmt"])

    cloze_css = _get_cloze_css()
    if cloze_css:
        nt["css"] = nt.get("css", "") + "\n" + cloze_css


def _ensure_autoregressive_cloze_notetype() -> str:
    status = _ensure_named_clone(AR_CLOZE_NAME, _find_stock_cloze_notetype())
    return "missing_stock_cloze" if status == "missing" else status


def _ensure_autoregressive_io_notetype() -> str:
    status = _ensure_named_clone(AR_IO_NAME, _find_stock_io_notetype())
    return "missing_stock_io" if status == "missing" else status


def _ensure_autoregressive_combined_notetype() -> str:
    status = _ensure_named_clone(
        AR_COMBINED_NAME,
        _find_stock_io_notetype(),
        _configure_combined_notetype,
    )
    return "missing_stock_io" if status == "missing" else status


def _ensure_notetypes() -> dict[str, str]:
    return {
        AR_CLOZE_NAME: _ensure_autoregressive_cloze_notetype(),
        AR_IO_NAME: _ensure_autoregressive_io_notetype(),
        AR_COMBINED_NAME: _ensure_autoregressive_combined_notetype(),
    }


def _cleanup_dump_dir() -> None:
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    for path in DUMP_DIR.iterdir():
        if path.is_file() and path.name not in _DUMP_FILENAMES:
            path.unlink(missing_ok=True)


def _on_profile_open() -> None:
    _cleanup_dump_dir()
    _ensure_notetypes()


gui_hooks.profile_did_open.append(_on_profile_open)


def _manual_setup() -> None:
    results = _ensure_notetypes()
    created = [name for name, status in results.items() if status == "created"]
    missing_io = [
        name for name, status in results.items() if status == "missing_stock_io"
    ]
    missing_cloze = [
        name for name, status in results.items() if status == "missing_stock_cloze"
    ]
    conflicts = [
        name for name, status in results.items() if status == "field_conflict"
    ]

    messages = []
    if created:
        messages.append("Created: " + ", ".join(created))
    if missing_cloze:
        messages.append("Missing stock Cloze notetype.")
    if missing_io:
        messages.append(
            "Create one stock Image Occlusion note first, then run setup again."
        )
    if conflicts:
        messages.append(
            "Cannot create combined notetype because the source Image Occlusion "
            "notetype already has one of the required combined field names."
        )
    if not messages:
        messages.append("All autoregressive note types already exist.")

    tooltip(" ".join(messages))


def _dump_path_for_mode(mode: str) -> Path:
    slug = {
        "cloze": "cloze",
        "io": "image-occlusion",
        "combined": "combined",
    }[mode]
    return DUMP_DIR / f"{slug}.json"


def _add_menu_actions() -> None:
    setup_action = QAction(f"Setup '{PACKAGE_NAME}' Note Types", mw)
    setup_action.triggered.connect(_manual_setup)
    mw.form.menuTools.addAction(setup_action)


gui_hooks.main_window_did_init.append(_add_menu_actions)


def _mode_for_card(card: Card) -> str | None:
    name = card.note_type().get("name")
    if name == AR_CLOZE_NAME:
        return "cloze"
    if name == AR_IO_NAME:
        return "io"
    if name == AR_COMBINED_NAME:
        return "combined"
    return None


def _on_question_shown(card: Card) -> None:
    global _active_mode

    _active_mode = None
    mode = _mode_for_card(card)
    if not mode:
        return

    _cleanup_dump_dir()
    dump_path = _dump_path_for_mode(mode)
    dump_path.write_text(
        json.dumps(
            {
                "mode": mode,
                "noteTypeName": card.note_type().get("name"),
                "cardId": card.id,
                "noteId": card.nid,
                "cardOrd": card.ord,
                "events": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    payload = json.dumps(
        {
            "mode": mode,
            "noteTypeName": card.note_type().get("name"),
            "cardId": card.id,
            "noteId": card.nid,
            "cardOrd": card.ord,
        }
    )
    mw.reviewer.web.eval(f"arcio.init({payload});")
    _active_mode = mode


def _on_answer_shown(card: Card) -> None:  # noqa: ARG001
    global _active_mode

    _active_mode = None
    mw.reviewer.web.eval("arcio.disable();")


def _on_shortcuts_will_change(state: str, shortcuts: list) -> None:
    if state != "review":
        return

    for i, (key, fn) in enumerate(shortcuts):
        if key != " ":
            continue

        original_fn = fn

        def space_handler(orig=original_fn) -> None:
            if _active_mode:
                mw.reviewer.web.eval("arcio.revealNext();")
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
    if handled[0] or not isinstance(context, aqt.reviewer.Reviewer):
        return handled
    if not message.startswith("arcioAutoDump:"):
        return handled

    try:
        payload = json.loads(unquote(message.removeprefix("arcioAutoDump:")))
        mode = payload["mode"]
        dump_path = _dump_path_for_mode(mode)
        if dump_path.exists():
            data = json.loads(dump_path.read_text(encoding="utf-8"))
        else:
            data = {
                "mode": mode,
                "noteTypeName": payload.get("noteTypeName"),
                "cardId": payload.get("cardId"),
                "noteId": payload.get("noteId"),
                "cardOrd": payload.get("cardOrd"),
                "events": [],
            }

        if "noteTypeName" in payload:
            data["noteTypeName"] = payload["noteTypeName"]
        if "cardId" in payload:
            data["cardId"] = payload["cardId"]
        if "noteId" in payload:
            data["noteId"] = payload["noteId"]
        if "cardOrd" in payload:
            data["cardOrd"] = payload["cardOrd"]

        data.setdefault("events", []).append(payload)
        dump_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        tooltip(f"Failed to write automatic reviewer dump: {exc}")
        return (True, None)
    return (True, None)


mw.addonManager.setWebExports(__name__, r"web/.*\.js")
gui_hooks.reviewer_did_show_question.append(_on_question_shown)
gui_hooks.reviewer_did_show_answer.append(_on_answer_shown)
gui_hooks.state_shortcuts_will_change.append(_on_shortcuts_will_change)
gui_hooks.webview_will_set_content.append(_on_webview_will_set_content)
gui_hooks.webview_did_receive_js_message.append(_on_js_message)
