package reversecallers;

public class WarmupController {
  private final Service service;

  public WarmupController(Service service) {
    this.service = service;
  }

  public void prime() {
    service.warmup();
  }
}
