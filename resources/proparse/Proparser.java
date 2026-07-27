import org.prorefactor.treeparser.ParseUnit;
import org.prorefactor.core.JPNode;
import com.joanju.proparse.Environment;
import org.prorefactor.core.schema.Schema;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

/**
 * Proparser - Proparse-based ABL source file parser for CrossWayAI.
 *
 * Supports two operating modes:
 *
 *   Single-file mode:
 *     --file <path>         Source file to parse (prints AST to stdout)
 *
 *   Batch mode (used by Proparse All Projects command):
 *     --srcdir <path>       Root source directory to scan recursively
 *     --outdir <path>       Output directory; mirrors the source tree as *.ast.json files
 *
 *   Shared options (both modes):
 *     --propath <csv>       Comma-separated PROPATH entries
 *     --schema  <path>      Combined proparse.schema file
 *     --proversion <ver>    OpenEdge version string (default: 12.8)
 */
public class Proparser {

    public static void main(String[] args) {
        // ── Argument parsing ──────────────────────────────────────────────
        String filePath    = null;
        String srcDir      = null;
        String outDir      = null;
        String propath     = null;
        String schemaPath  = null;
        String proversion  = "12.8";

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--file":       if (i + 1 < args.length) filePath   = args[++i]; break;
                case "--srcdir":     if (i + 1 < args.length) srcDir     = args[++i]; break;
                case "--outdir":     if (i + 1 < args.length) outDir     = args[++i]; break;
                case "--propath":    if (i + 1 < args.length) propath    = args[++i]; break;
                case "--schema":     if (i + 1 < args.length) schemaPath = args[++i]; break;
                case "--proversion": if (i + 1 < args.length) proversion = args[++i]; break;
            }
        }

        // Validate required args
        boolean isSingleMode = filePath != null;
        boolean isBatchMode  = srcDir != null && outDir != null;

        if (!isSingleMode && !isBatchMode) {
            System.err.println("Proparser: No operation specified.");
            System.err.println("  Single-file: --file <path> [--propath <csv>] [--schema <path>] [--proversion <ver>]");
            System.err.println("  Batch:       --srcdir <path> --outdir <path> [--propath <csv>] [--schema <path>] [--proversion <ver>]");
            System.exit(1);
        }

        // ── Environment setup (done once, shared across all files) ────────
        try {
            Environment env = Environment.instance();
            env.configSet("proversion", proversion);

            if (propath != null && !propath.isEmpty()) {
                env.configSet("propath", propath);
            }

            if (schemaPath != null && !schemaPath.isEmpty()) {
                File schemaFile = new File(schemaPath);
                if (!schemaFile.exists()) {
                    System.err.println("Proparser: Schema file not found: " + schemaPath);
                    System.exit(1);
                }
                Schema.getInstance().loadSchema(schemaPath);
            }

        } catch (Exception e) {
            System.err.println("Proparser: Failed to initialize Proparse environment: " + e.getMessage());
            System.exit(1);
        }

        // ── Dispatch ──────────────────────────────────────────────────────
        if (isSingleMode) {
            parseSingleFile(filePath);
        } else {
            parseBatch(srcDir, outDir);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Single-file mode: parse one ABL file and print the AST tree to stdout
    // ─────────────────────────────────────────────────────────────────────────

    private static void parseSingleFile(String filePath) {
        File sourceFile = new File(filePath);
        if (!sourceFile.exists()) {
            System.err.println("Proparser: File not found: " + sourceFile.getAbsolutePath());
            System.exit(1);
        }

        try {
            ParseUnit pu = new ParseUnit(sourceFile);
            pu.treeParser01();
            JPNode root = pu.getTopNode();
            // Print the AST tree as indented text to stdout
            printAstNode(root, 0);
        } catch (Exception e) {
            System.err.println("Proparser: Parse error for " + filePath + ": " + e.getMessage());
            System.exit(1);
        }
    }

    private static void printAstNode(JPNode node, int depth) {
        if (node == null) return;
        StringBuilder indent = new StringBuilder();
        for (int i = 0; i < depth; i++) indent.append("  ");
        System.out.println(indent + "-> '" + node.getText() + "' (Type: " + node.getType() + ") line " + node.getLine());
        JPNode child = node.firstChild();
        while (child != null) {
            printAstNode(child, depth + 1);
            child = child.nextSibling();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch mode: recursively parse all ABL files in srcDir, write .ast.json
    //             files to outDir, mirroring the source directory tree.
    // ─────────────────────────────────────────────────────────────────────────

    private static void parseBatch(String srcDir, String outDir) {
        File src = new File(srcDir);
        File out = new File(outDir);

        if (!src.exists() || !src.isDirectory()) {
            System.err.println("Proparser: Source directory not found: " + srcDir);
            System.exit(1);
        }

        out.mkdirs();

        int[] counts = {0, 0}; // [success, error]
        parseDirectory(src, src, out, counts);

        System.out.println("Proparser: Batch complete. Parsed " + counts[0] + " file(s), " + counts[1] + " error(s).");
    }

    private static void parseDirectory(File baseDir, File currentDir, File outRootDir, int[] counts) {
        File[] entries = currentDir.listFiles();
        if (entries == null) return;

        for (File entry : entries) {
            if (entry.isDirectory()) {
                // Pass outRootDir downwards; directories will be created lazily when files are written
                parseDirectory(baseDir, entry, outRootDir, counts);
            } else if (isAblFile(entry.getName())) {
                parseOneFileToOutput(baseDir, entry, outRootDir, counts);
            }
        }
    }

    private static boolean isAblFile(String name) {
        String lower = name.toLowerCase();
        return lower.endsWith(".p") || lower.endsWith(".cls") || lower.endsWith(".w") || lower.endsWith(".i");
    }

    private static void parseOneFileToOutput(File baseDir, File sourceFile, File outRootDir, int[] counts) {
        // Compute the relative path of the source file from the base source dir
        String relPath = baseDir.toURI().relativize(sourceFile.toURI()).getPath();
        // Output file: same relative path + ".ast.json" extension replacing the original ext
        String outRelPath = relPath.replaceAll("\\.[^.]+$", "") + ".ast.json";
        File outFile = new File(outRootDir, outRelPath);
        outFile.getParentFile().mkdirs();

        try {
            ParseUnit pu = new ParseUnit(sourceFile);
            pu.treeParser01();
            JPNode root = pu.getTopNode();

            try (PrintWriter writer = new PrintWriter(new OutputStreamWriter(new FileOutputStream(outFile), StandardCharsets.UTF_8))) {
                writer.println("{");
                writer.println("  \"file\": " + jsonString(sourceFile.getAbsolutePath()) + ",");
                writer.println("  \"ast\": [");
                writeAstJson(root, 0, writer, true);
                writer.println("  ]");
                writer.println("}");
            }

            System.out.println("  [OK] " + outFile.getAbsolutePath());
            counts[0]++;
        } catch (Exception e) {
            // Write an error sentinel file so the JS side can detect failures per-file
            try (PrintWriter writer = new PrintWriter(new OutputStreamWriter(new FileOutputStream(outFile), StandardCharsets.UTF_8))) {
                writer.println("{");
                writer.println("  \"file\": " + jsonString(sourceFile.getAbsolutePath()) + ",");
                writer.println("  \"error\": " + jsonString(e.toString()));
                writer.println("}");
            } catch (Exception ignored) {}

            System.out.println("  [ERROR] " + outFile.getAbsolutePath());
            counts[1]++;
        }
    }

    /**
     * Writes the AST subtree rooted at node as a JSON array of node objects.
     */
    private static void writeAstJson(JPNode node, int depth, PrintWriter writer, boolean isLast) {
        if (node == null) return;

        String indent = "    " + "  ".repeat(depth);
        String nodeType = com.joanju.proparse.NodeTypes.getTypeName(node.getType());
        String nodeClass = node.getClass().getSimpleName();

        writer.print(indent + "{");
        writer.print(" \"nodeClass\": " + jsonString(nodeClass) + ",");
        writer.print(" \"nodeType\": " + jsonString(nodeType) + ",");
        writer.print(" \"typeId\": " + node.getType() + ",");
        writer.print(" \"text\": " + jsonString(node.getText()) + ",");
        writer.print(" \"line\": " + node.getLine() + ",");
        writer.print(" \"column\": " + node.getColumn() + ",");
        writer.print(" \"children\": [");

        JPNode child = node.firstChild();
        if (child == null) {
            writer.print("]");
        } else {
            writer.println();
            while (child != null) {
                boolean lastChild = (child.nextSibling() == null);
                writeAstJson(child, depth + 1, writer, lastChild);
                child = child.nextSibling();
            }
            writer.print(indent + "  ]");
        }

        writer.println(" }" + (isLast ? "" : ","));
    }

    private static String jsonString(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\")
                       .replace("\"", "\\\"")
                       .replace("\n", "\\n")
                       .replace("\r", "\\r")
                       .replace("\t", "\\t") + "\"";
    }
}
