'use strict';

var _createClass = function () {

  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }
  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps); return Constructor;
  };
}();

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
    if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); }
  return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

// we do not use the imports because we pull in react and react dom from cdn
// import React from 'react'
// import ReactDOM from 'react-dom'

var ClapTyper = function (_React$Component) {
  _inherits(ClapTyper, _React$Component);

  function ClapTyper(props) {
    _classCallCheck(this, ClapTyper);

    var _this = _possibleConstructorReturn(this, (ClapTyper.__proto__ || Object.getPrototypeOf(ClapTyper)).call(this, props));

    _this.state = {
      text: '',
      emoji: '👏'
    };
    return _this;
  }

  _createClass(ClapTyper, [{
    key: 'componentDidMount',
    value: function componentDidMount() {
      try {
        twttr.widgets.load();
      } catch (err) {
        // ignore errors
      }
    }
  }, {
    key: '_onChange',
    value: function _onChange(text) {
      this.setState({
        text: text
      });
    }
  }, {
    key: '_onSelectChange',
    value: function _onSelectChange(emoji) {
      this.setState({
        emoji: emoji
      });
    }
  }, {
    key: '_clap',
    value: function _clap(text) {
      return text.split(/\s+/).join(' ' + this.state.emoji + ' ');
    }
  }, {
    key: 'render',
    value: function render() {
      var _this2 = this;

      return React.createElement(
        'div',
        null,
        React.createElement(
          'h1',
          null,
          'Clap ',
          this.state.emoji,
          ' Typer'
        ),
        React.createElement('input', { type: 'text', placeholder: 'type some woke shit here', onChange: function onChange(e) {
            return _this2._onChange(e.target.value);
          } }),
        React.createElement('br', null),
        React.createElement(
          'select',
          { value: this.state.emoji, onChange: function onChange(e) {
              return _this2._onSelectChange(e.target.value);
            } },
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F' },
            '\uD83D\uDC4F'
          ),
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F\uD83C\uDFFB' },
            '\uD83D\uDC4F\uD83C\uDFFB'
          ),
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F\uD83C\uDFFC' },
            '\uD83D\uDC4F\uD83C\uDFFC'
          ),
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F\uD83C\uDFFD' },
            '\uD83D\uDC4F\uD83C\uDFFD'
          ),
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F\uD83C\uDFFE' },
            '\uD83D\uDC4F\uD83C\uDFFE'
          ),
          React.createElement(
            'option',
            { value: '\uD83D\uDC4F\uD83C\uDFFF' },
            '\uD83D\uDC4F\uD83C\uDFFF'
          )
        ),
        React.createElement('br', null),
        React.createElement('textarea', { rows: '10', value: this._clap(this.state.text) }),
        React.createElement(
          'a',
          { href: "https://twitter.com/intent/tweet?text=" + this._clap(this.state.text) },
          'Tweet'
        ),
        React.createElement(
          'a',
          { href: 'http://sick.af', className: 'black pull-right' },
          'made by sick.af'
        )
      );
    }
  }]);

  return ClapTyper;
}(React.Component);

ReactDOM.render(React.createElement(ClapTyper, null), document.getElementById('root'));
