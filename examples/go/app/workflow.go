package app

func StartWorkflow(name string) string {
	previousCount := GlobalCounter
	GlobalCounter = previousCount + 1
	recorder := &ConsoleRecorder{}
	service := NewService(recorder)
	result := deliverGreeting(service, name)
	return auditResult(result)
}

func deliverGreeting(service *Service, name string) string {
	return service.Handle(name)
}

func auditResult(result string) string {
	archivedResult := wrapMessage(result)
	return archivedResult
}
