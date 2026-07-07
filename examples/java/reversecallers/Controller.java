package reversecallers;

public class Controller {
  private final Service service;

  public Controller(Service service) {
    this.service = service;
  }

  public void handle() {
    service.run();
  }
}
