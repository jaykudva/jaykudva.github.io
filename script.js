const options = {
    bottom: '32px', // default: '32px'
    right: '32px', // default: '32px'
    left: 'unset', // default: 'unset'
    time: '0.2s', // default: '0.3s'
    mixColor: '#fff', // default: '#fff'
    backgroundColor: '#d8d3ca',  // default: '#fff'
    buttonColorDark: '#272c35',  // default: '#100f2c'
    buttonColorLight: '#fff', // default: '#fff'
    saveInCookies: true, // default: true,
    label: String.fromCodePoint(0x1F313), // default: ''
    autoMatchOsTheme: true // default: true
}

const darkmode = new Darkmode(options);

darkmode.showWidget();