export namespace model {
	
	export class CausalEdge {
	    from: number;
	    to: number;
	    time: number;
	    category: string;
	
	    static createFrom(source: any = {}) {
	        return new CausalEdge(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.from = source["from"];
	        this.to = source["to"];
	        this.time = source["time"];
	        this.category = source["category"];
	    }
	}
	export class Region {
	    start: number;
	    end: number;
	    name: string;
	    depth: number;
	
	    static createFrom(source: any = {}) {
	        return new Region(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.name = source["name"];
	        this.depth = source["depth"];
	    }
	}
	export class Interval {
	    start: number;
	    end: number;
	    state: string;
	    blockReason?: string;
	
	    static createFrom(source: any = {}) {
	        return new Interval(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.state = source["state"];
	        this.blockReason = source["blockReason"];
	    }
	}
	export class Goroutine {
	    id: number;
	    name: string;
	    createdAt: number;
	    endedAt: number;
	    intervals: Interval[];
	    regions?: Region[];
	
	    static createFrom(source: any = {}) {
	        return new Goroutine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.createdAt = source["createdAt"];
	        this.endedAt = source["endedAt"];
	        this.intervals = this.convertValues(source["intervals"], Interval);
	        this.regions = this.convertValues(source["regions"], Region);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Log {
	    time: number;
	    goId: number;
	    category: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Log(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.goId = source["goId"];
	        this.category = source["category"];
	        this.message = source["message"];
	    }
	}
	
	export class TraceSummary {
	    startTime: number;
	    endTime: number;
	    goroutines: Goroutine[];
	    edges: CausalEdge[];
	    logs?: Log[];
	
	    static createFrom(source: any = {}) {
	        return new TraceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startTime = source["startTime"];
	        this.endTime = source["endTime"];
	        this.goroutines = this.convertValues(source["goroutines"], Goroutine);
	        this.edges = this.convertValues(source["edges"], CausalEdge);
	        this.logs = this.convertValues(source["logs"], Log);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

