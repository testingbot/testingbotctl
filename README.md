# TestingBot CLI

TestingBot CLI is a command-line interface to run tests with Espresso, XCUITest and Maestro on TestingBot.

## Features

- Run Espresso tests on TestingBot
- Run XCUITest tests on TestingBot
- Run Maestro tests on TestingBot

## Installation

To install TestingBot CLI, use the following command:

```sh
npm install -g testingbotctl
```

## Usage

Here are some example commands to get you started:

### Run Espresso Tests

```sh
testingbotctl run espresso --app your-app.apk --test your-test.apk
```

### Run XCUITest Tests

```sh
testingbotctl run xcuitest --app your-app.ipa --test your-test.zip
```

### Run Maestro Tests

```sh
testingbotctl run maestro --app your-app.apk --test your-test.yaml
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the MIT License.