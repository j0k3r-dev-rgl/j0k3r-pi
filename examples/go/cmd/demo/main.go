package main

import (
	"fmt"

	workflow "example.com/code-research-go-fixtures/app"
)

func main() {
	workflowResult := workflow.StartWorkflow(" Ada ")
	fmt.Println(workflowResult)
}
