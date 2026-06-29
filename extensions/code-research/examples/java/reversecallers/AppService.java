package reversecallers;

public class AppService implements Service {
  public void run() {
    helper();
  }

  public void warmup() {
    helper();
  }

  private void helper() {}
}
