package reversecallers;

public class Bootstrap {
  private final WarmupController warmupController;

  public Bootstrap(WarmupController warmupController) {
    this.warmupController = warmupController;
  }

  public void startWarmup() {
    warmupController.prime();
  }
}
