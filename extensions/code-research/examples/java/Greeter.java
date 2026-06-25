/**
 * Java fixture for testing the find_symbol tool.
 */

public interface Greeter {
    String greet(String name);
}

class ConsoleGreeter implements Greeter {
    private final String prefix;

    public ConsoleGreeter(String prefix) {
        this.prefix = prefix;
    }

    @Override
    public String greet(String name) {
        return prefix + " " + name;
    }
}
