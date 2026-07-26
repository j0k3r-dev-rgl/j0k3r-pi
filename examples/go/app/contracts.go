package app

const DefaultGreeting = "hello"

var GlobalCounter = 0

type Greeter interface {
	Greet(name string) string
}

type Recorder interface {
	Record(message string)
}

type FriendlyGreeter struct{}

func (FriendlyGreeter) Greet(name string) string {
	return composeGreeting(normalizeName(name))
}
