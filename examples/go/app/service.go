package app

type ConsoleRecorder struct {
	history []string
}

func (r *ConsoleRecorder) Record(message string) {
	r.history = append(r.history, message)
}

type Service struct {
	recorder Recorder
	greeter  Greeter
}

func NewService(recorder Recorder) *Service {
	return &Service{recorder: recorder, greeter: FriendlyGreeter{}}
}

func (s *Service) Greet(name string) string {
	return composeGreeting(normalizeName(name))
}

func (s *Service) Handle(name string) string {
	greeting := s.greeter.Greet(name)
	s.recorder.Record(greeting)
	notify(greeting)
	return greeting
}
