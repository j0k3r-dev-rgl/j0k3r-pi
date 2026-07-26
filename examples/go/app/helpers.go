package app

import "strings"

func normalizeName(name string) string {
	trimmedName := strings.TrimSpace(name)
	return trimmedName
}

func composeGreeting(name string) string {
	return DefaultGreeting + ", " + name
}

func notify(message string) {
	sinkMessage(message)
}

func sinkMessage(message string) {
	_ = message
}

func wrapMessage(message string) string {
	formattedMessage := formatMessage(message)
	return formattedMessage
}

func formatMessage(message string) string {
	return strings.ToUpper(message)
}
