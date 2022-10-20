import { strict as assert } from "assert";

const insertion_cost = 1;
const deletion_cost = 1;
const substitution_cost = 1;
const substitution_multiplier = 2;

function find_min_action(actions: [number, number][]) {
    let min = actions[0];
    for(const action of actions) {
        if(action[0] < min[0]) { // closest
            min = action;
        } else if(action[0] == min[0] && action[1] < min[1]) { // fewest substitutions up until this point
            min = action;
        }
    }
    return min;
}

export function calculate_nonlinear_substitution_cost(n: number) {
    // sum from i=0 to n of b * m^i
    // implicitly subtract 1 from n
    return substitution_cost * (Math.pow(substitution_multiplier, n) - 1) / (substitution_multiplier - 1);
}

export function weighted_levenshtein_debug(src: string, target: string) {
    // Stores tuples [distance, substitution_count]
    const d = new Array(src.length + 1)
        .fill(0)
        .map(() => new Array(target.length + 1).fill(0).map(() => [0, 0]));
    for(let i = 1; i <= src.length; i++) {
        d[i][0] = [i, 0];
    }
    for(let j = 1; j <= target.length; j++) {
        d[0][j] = [j, 0];
    }
    for(let i = 1; i <= src.length; i++) {
        for(let j = 1; j <= target.length; j++) {
            // for now because the variable is also used to indicate whether to increment
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            assert(substitution_cost == 1);
            const ts = src[i - 1] == target[j - 1] ? 0 : substitution_cost;
            const actions: [number, number][] = [
                [d[i - 1][j    ][0] + deletion_cost,  d[i - 1][j    ][1]],
                [d[i    ][j - 1][0] + insertion_cost, d[i    ][j - 1][1]],
                [d[i - 1][j - 1][0] + ts,             d[i - 1][j - 1][1] + ts]
            ];
            d[i][j] = find_min_action(actions);
        }
    }
    //console.log(d);
    // apply non-linear substitution cost
    d[src.length][target.length][0] = d[src.length][target.length][0] - d[src.length][target.length][1] +
        (d[src.length][target.length][1] == 0
            ? 0
            : calculate_nonlinear_substitution_cost(d[src.length][target.length][1]));
    return d[src.length][target.length];
}
export function weighted_levenshtein(src: string, target: string) {
    return weighted_levenshtein_debug(src, target)[0];
}
