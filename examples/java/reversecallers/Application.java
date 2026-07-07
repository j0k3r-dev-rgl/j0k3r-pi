package reversecallers;

public class Application {
  private final Controller controller;

  public Application(Controller controller) {
    this.controller = controller;
  }

  public void startHttp() {
    controller.handle();
  }
}
