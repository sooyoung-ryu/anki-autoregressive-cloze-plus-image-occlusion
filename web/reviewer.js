(function () {
    if (window.arcio) {
        return;
    }

    var _state = {
        enabled: false,
        mode: null,
        noteTypeName: null,
        cardId: null,
        noteId: null,
        cardOrd: null,
        steps: [],
        phase: 0,
        phaseIdx: 0,
        ioRevealed: 0,
        ioHiddenTotal: -1,
        ioLastConfig: null,
        eventIndex: 0,
    };

    var _textSelectors = {
        text: ".cloze",
        before: "#ar-text1 .cloze",
        after: "#ar-text2 .cloze",
    };

    function _qaRoot() {
        return document.getElementById("qa") || document;
    }

    function _queryAll(selector) {
        return Array.from(_qaRoot().querySelectorAll(selector));
    }

    function _textSpans(step) {
        var selector = _textSelectors[step];
        if (!selector) {
            return [];
        }
        return _queryAll(selector).filter(function (el) {
            return el instanceof HTMLSpanElement && !el.dataset.shape;
        });
    }

    function _shapeOrder(a, b) {
        if (a.ordinal !== b.ordinal) {
            return a.ordinal - b.ordinal;
        }
        if (a.top !== b.top) {
            return a.top - b.top;
        }
        return a.left - b.left;
    }

    function _shapeKey(shape) {
        return [
            shape.ordinal,
            Math.round(shape.top * 1e4),
            Math.round(shape.left * 1e4),
        ].join(",");
    }

    function _hiddenShapeElements() {
        return _queryAll(".cloze, .cloze-inactive").filter(function (el) {
            if (!(el instanceof HTMLDivElement) || !el.dataset.shape) {
                return false;
            }
            return (
                el.classList.contains("cloze")
                || (
                    el.classList.contains("cloze-inactive")
                    && el.dataset.occludeinactive === "1"
                )
            );
        });
    }

    function _countHiddenShapes() {
        return _hiddenShapeElements().length;
    }

    function _stepsForMode(mode) {
        if (mode === "cloze") {
            return ["text"];
        }
        if (mode === "io") {
            return ["io"];
        }
        if (mode === "combined") {
            return ["before", "io", "after"];
        }
        return [];
    }

    function _currentStep() {
        return _state.steps[_state.phase] || null;
    }

    function _remainingForStep(step, mutateState) {
        if (!step) {
            return 0;
        }
        if (step === "io") {
            if (_state.ioHiddenTotal !== -1) {
                return _state.ioHiddenTotal - _state.ioRevealed;
            }
            if (!mutateState) {
                return _countHiddenShapes() - _state.ioRevealed;
            }
            if (_state.ioHiddenTotal === -1) {
                _state.ioHiddenTotal = _countHiddenShapes();
            }
            return _state.ioHiddenTotal - _state.ioRevealed;
        }
        return _textSpans(step).length - _state.phaseIdx;
    }

    function _remainingInCurrentStep() {
        return _remainingForStep(_currentStep(), true);
    }

    function _advancePastEmptySteps() {
        while (
            _state.phase < _state.steps.length
            && _remainingInCurrentStep() <= 0
        ) {
            _state.phase += 1;
            _state.phaseIdx = 0;
        }
        return _state.phase >= _state.steps.length;
    }

    function _resetState(mode) {
        _state.enabled = false;
        _state.mode = mode || null;
        _state.noteTypeName = null;
        _state.cardId = null;
        _state.noteId = null;
        _state.cardOrd = null;
        _state.steps = _stepsForMode(mode);
        _state.phase = 0;
        _state.phaseIdx = 0;
        _state.ioRevealed = 0;
        _state.ioHiddenTotal = -1;
        _state.eventIndex = 0;
        _state.enabled = _state.steps.length > 0;
    }

    function _revealSpan(step) {
        var span = _textSpans(step)[_state.phaseIdx];
        if (!span) {
            return;
        }

        var html = span.dataset.cloze;
        if (html == null || html === "") {
            return;
        }

        span.innerHTML = html;
        _state.phaseIdx += 1;
        if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
            MathJax.typesetPromise([span]);
        }
    }

    function _showAnswerSoon() {
        _state.enabled = false;
        requestAnimationFrame(function () {
            pycmd("ans");
        });
    }

    function _hasQuestionDom() {
        var qa = document.getElementById("qa");
        if (!qa) {
            return false;
        }
        if ((qa.innerHTML || "").trim() !== "") {
            return true;
        }
        if (document.getElementById("image-occlusion-container")) {
            return true;
        }
        if (_queryAll(".cloze, .cloze-inactive, .cloze-highlight").length > 0) {
            return true;
        }
        return false;
    }

    function _filteredShapeData(data) {
        if (!_state.enabled || (_state.mode !== "io" && _state.mode !== "combined")) {
            return data;
        }
        if (_state.ioRevealed <= 0) {
            return data;
        }

        var allHidden = data.activeShapes
            .concat(data.inactiveShapes.filter(function (shape) {
                return shape.occludeInactive;
            }))
            .sort(_shapeOrder);

        if (!allHidden.length) {
            return data;
        }

        var revealCount = Math.min(_state.ioRevealed, allHidden.length);
        var revealedKeys = {};
        for (var i = 0; i < revealCount; i++) {
            revealedKeys[_shapeKey(allHidden[i])] = true;
        }

        return {
            activeShapes: data.activeShapes.filter(function (shape) {
                return !revealedKeys[_shapeKey(shape)];
            }),
            inactiveShapes: data.inactiveShapes.filter(function (shape) {
                return !revealedKeys[_shapeKey(shape)];
            }),
            highlightShapes: (data.highlightShapes || []).concat(
                data.activeShapes.filter(function (shape) {
                    return revealedKeys[_shapeKey(shape)];
                })
            ),
            properties: data.properties,
        };
    }

    function _wrappedSetup(config) {
        _state.ioLastConfig = config || {};
        var userHook = _state.ioLastConfig.onWillDrawShapes;

        var wrapped = Object.assign({}, _state.ioLastConfig, {
            onWillDrawShapes: function (data, ctx) {
                var base = userHook ? (userHook(data, ctx) || data) : data;
                return _filteredShapeData(base);
            },
        });

        return _wrappedSetup._original.call(this, wrapped);
    }

    function _ensureImageOcclusionHook() {
        if (
            typeof anki === "undefined"
            || !anki.imageOcclusion
            || typeof anki.imageOcclusion.setup !== "function"
        ) {
            return;
        }

        var currentSetup = anki.imageOcclusion.setup;
        if (currentSetup.__arcioWrapped) {
            return;
        }

        _wrappedSetup._original = currentSetup;
        _wrappedSetup.__arcioWrapped = true;
        anki.imageOcclusion.setup = _wrappedSetup;
        anki.setupImageCloze = anki.imageOcclusion.setup;
    }

    function _rerenderImageOcclusion() {
        if (
            typeof anki === "undefined"
            || !anki.imageOcclusion
            || typeof anki.imageOcclusion.setup !== "function"
            || _state.ioLastConfig == null
        ) {
            return;
        }
        anki.imageOcclusion.setup(_state.ioLastConfig);
    }

    function _revealIoStep() {
        if (_state.ioHiddenTotal === -1) {
            _state.ioHiddenTotal = _countHiddenShapes();
        }
        _state.ioRevealed += 1;
        _rerenderImageOcclusion();
    }

    function _safeOuterHTML(el) {
        return el && el.outerHTML ? el.outerHTML : null;
    }

    function _safeInnerHTML(el) {
        return el && typeof el.innerHTML === "string" ? el.innerHTML : null;
    }

    function _serializeElement(el, index) {
        return {
            index: index,
            tag: el.tagName,
            id: el.id || null,
            className: el.className,
            textContent: el.textContent,
            innerHTML: _safeInnerHTML(el),
            outerHTML: _safeOuterHTML(el),
            dataset: Object.assign({}, el.dataset),
        };
    }

    function _serializeShapeElement(el, index) {
        return Object.assign(_serializeElement(el, index), {
            ordinal: Number(el.dataset.ordinal || 0),
            top: Number(el.dataset.top || 0),
            left: Number(el.dataset.left || 0),
            occludeInactive: el.dataset.occludeinactive || null,
        });
    }

    function _serializeConfig(value, depth) {
        if (depth <= 0) {
            return "[max-depth]";
        }
        if (value == null) {
            return value;
        }
        if (Array.isArray(value)) {
            return value.slice(0, 20).map(function (item) {
                return _serializeConfig(item, depth - 1);
            });
        }
        if (typeof value === "function") {
            return String(value).slice(0, 1200);
        }
        if (typeof value !== "object") {
            return value;
        }

        var out = {};
        Object.keys(value).slice(0, 50).forEach(function (key) {
            out[key] = _serializeConfig(value[key], depth - 1);
        });
        return out;
    }

    function _snapshot(label) {
        var qa = _qaRoot();
        var allClozeLike = _queryAll(".cloze, .cloze-inactive, .cloze-highlight");
        var hiddenShapes = _hiddenShapeElements().sort(function (a, b) {
            return _shapeOrder(
                {
                    ordinal: Number(a.dataset.ordinal || 0),
                    top: Number(a.dataset.top || 0),
                    left: Number(a.dataset.left || 0),
                },
                {
                    ordinal: Number(b.dataset.ordinal || 0),
                    top: Number(b.dataset.top || 0),
                    left: Number(b.dataset.left || 0),
                }
            );
        });

        return {
            label: label || "manual",
            timestamp: Date.now(),
            eventIndex: _state.eventIndex,
            mode: _state.mode,
            noteTypeName: _state.noteTypeName,
            cardId: _state.cardId,
            noteId: _state.noteId,
            cardOrd: _state.cardOrd,
            location: {
                href: window.location.href,
                pathname: window.location.pathname,
            },
            state: {
                enabled: _state.enabled,
                mode: _state.mode,
                steps: _state.steps.slice(),
                phase: _state.phase,
                phaseIdx: _state.phaseIdx,
                currentStep: _currentStep(),
                remainingInCurrentStep: _remainingForStep(_currentStep(), false),
                ioRevealed: _state.ioRevealed,
                ioHiddenTotal: _state.ioHiddenTotal,
            },
            containers: {
                qaId: qa.id || null,
                qaInnerHTML: _safeInnerHTML(qa),
                qaOuterHTML: _safeOuterHTML(qa),
                imageOcclusionContainer: _safeOuterHTML(
                    document.getElementById("image-occlusion-container")
                ),
                imageOcclusionCanvas: _safeOuterHTML(
                    document.getElementById("image-occlusion-canvas")
                ),
                before: _safeOuterHTML(document.getElementById("ar-text1")),
                after: _safeOuterHTML(document.getElementById("ar-text2")),
            },
            spans: {
                text: _textSpans("text").map(_serializeElement),
                before: _textSpans("before").map(_serializeElement),
                after: _textSpans("after").map(_serializeElement),
            },
            shapes: {
                hiddenCount: hiddenShapes.length,
                hidden: hiddenShapes.map(_serializeShapeElement),
            },
            dom: {
                allClozeLike: allClozeLike.map(_serializeElement),
                bodyClassName: document.body ? document.body.className : null,
            },
            ioSetup: {
                hasAnki: typeof anki !== "undefined",
                hasImageOcclusion:
                    typeof anki !== "undefined" && !!anki.imageOcclusion,
                setupWrapped:
                    typeof anki !== "undefined"
                    && !!anki.imageOcclusion
                    && !!anki.imageOcclusion.setup
                    && !!anki.imageOcclusion.setup.__arcioWrapped,
                setupSource:
                    typeof anki !== "undefined"
                    && !!anki.imageOcclusion
                    && typeof anki.imageOcclusion.setup === "function"
                        ? String(anki.imageOcclusion.setup).slice(0, 2000)
                        : null,
                lastConfig: _serializeConfig(_state.ioLastConfig, 4),
            },
        };
    }

    function _sendAutoDump(label) {
        pycmd(
            "arcioAutoDump:"
            + encodeURIComponent(JSON.stringify(_snapshot(label || "manual")))
        );
        _state.eventIndex += 1;
    }

    function _scheduleQuestionDump(attempt) {
        if (!_state.enabled) {
            return;
        }
        if (_hasQuestionDom() || attempt >= 12) {
            _sendAutoDump("question_shown");
            return;
        }
        setTimeout(function () {
            _scheduleQuestionDump(attempt + 1);
        }, 25);
    }

    window.arcio = {
        init: function (payload) {
            _ensureImageOcclusionHook();
            _resetState(payload && payload.mode);
            _state.noteTypeName = (payload && payload.noteTypeName) || null;
            _state.cardId = (payload && payload.cardId) || null;
            _state.noteId = (payload && payload.noteId) || null;
            _state.cardOrd = (payload && payload.cardOrd) || null;
            _scheduleQuestionDump(0);
        },

        disable: function () {
            _resetState(null);
            _state.ioLastConfig = null;
        },

        revealNext: function () {
            if (!_state.enabled) {
                _sendAutoDump("before_answer");
                pycmd("ans");
                return;
            }

            if (_advancePastEmptySteps()) {
                _sendAutoDump("before_answer");
                _showAnswerSoon();
                return;
            }

            var step = _currentStep();
            if (step === "io") {
                _revealIoStep();
            } else {
                _revealSpan(step);
            }

            _sendAutoDump("reveal_step");

            if (_advancePastEmptySteps()) {
                _sendAutoDump("before_answer");
                _showAnswerSoon();
            }
        },
    };

    _ensureImageOcclusionHook();
}());
